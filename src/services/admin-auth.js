import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from '../utils/http-error.js';

const scrypt = promisify(scryptCallback);
const TOKEN_ISSUER = 'sports-school-licensing-api';
const TOKEN_AUDIENCE = 'sports-school-admin';
const TOKEN_TTL_SECONDS = 20 * 60;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_LENGTH = 64;

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

export async function hashPassword(password) {
  if (
    typeof password !== 'string' ||
    password.length < 14 ||
    password.length > 1024
  ) {
    throw new TypeError('Password must contain 14 to 1024 characters');
  }
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, SCRYPT_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    Buffer.from(derivedKey).toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltValue, hashValue] = String(encoded).split('$');
  if (
    algorithm !== 'scrypt' ||
    Number(n) !== SCRYPT_N ||
    Number(r) !== SCRYPT_R ||
    Number(p) !== SCRYPT_P ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }
  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(hashValue, 'base64url');
    if (salt.length !== 16 || expected.length !== SCRYPT_LENGTH) return false;
    const actual = Buffer.from(
      await scrypt(
        password,
        salt,
        expected.length,
        { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
      ),
    );
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

export async function consumePasswordVerification(password) {
  await scrypt(
    password,
    Buffer.alloc(16),
    SCRYPT_LENGTH,
    {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    },
  );
}

export function issueAdminToken(admin, secret, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: TOKEN_ISSUER,
    aud: TOKEN_AUDIENCE,
    sub: admin.id,
    role: admin.role,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  };
  const input = `${encode(header)}.${encode(payload)}`;
  const signature = createHmac('sha256', secret)
    .update(input)
    .digest('base64url');
  return `${input}.${signature}`;
}

export function verifyAdminToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const input = `${parts[0]}.${parts[1]}`;
    const expected = createHmac('sha256', secret)
      .update(input)
      .digest();
    const actual = Buffer.from(parts[2], 'base64url');
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      return null;
    }

    const nowSeconds = Math.floor(now / 1000);
    if (
      payload.iss !== TOKEN_ISSUER ||
      payload.aud !== TOKEN_AUDIENCE ||
      typeof payload.sub !== 'string' ||
      !['OWNER', 'ADMIN', 'SUPPORT'].includes(payload.role) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= nowSeconds ||
      !Number.isInteger(payload.iat) ||
      payload.iat > nowSeconds + 30
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function authenticateAdmin(secret) {
  return (req, _res, next) => {
    const authorization = req.get('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
    const admin = match
      ? verifyAdminToken(match[1], secret)
      : null;
    if (!admin) return next(new HttpError(401, 'ADMIN_AUTH_REQUIRED'));
    req.admin = admin;
    return next();
  };
}

export function requireAdminRole(...roles) {
  return (req, _res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return next(new HttpError(403, 'ADMIN_FORBIDDEN'));
    }
    return next();
  };
}
