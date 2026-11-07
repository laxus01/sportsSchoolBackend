import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { loadAppConfig } from '../config/app-config';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_LENGTH = 64;
const TOKEN_ISSUER = 'sports-school-licensing-api';
const TOKEN_AUDIENCE = 'sports-school-admin';
const TOKEN_TTL_SECONDS = 20 * 60;

export type AdminRole = 'OWNER' | 'ADMIN' | 'SUPPORT';
export interface AdminPrincipal {
  id: string;
  role: AdminRole;
}

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const decodeJson = (value: string) =>
  JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

function deriveScrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      SCRYPT_LENGTH,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: 64 * 1024 * 1024,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key as Buffer);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 14 || password.length > 1024) {
    throw new TypeError('Password must contain 14 to 1024 characters');
  }
  const salt = randomBytes(16);
  const hash = await deriveScrypt(password, salt);
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
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
  const salt = Buffer.from(saltValue, 'base64url');
  const expected = Buffer.from(hashValue, 'base64url');
  if (salt.length !== 16 || expected.length !== SCRYPT_LENGTH) return false;
  try {
    const actual = await deriveScrypt(password, salt);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export async function consumePasswordVerification(
  password: string,
): Promise<void> {
  await deriveScrypt(password, Buffer.alloc(16));
}

export function issueAdminToken(
  admin: { id: string; role: AdminRole },
  secret: string,
  now = Date.now(),
): string {
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

export function verifyAdminToken(
  token: string,
  secret: string,
  now = Date.now(),
): AdminPrincipal | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const expected = createHmac('sha256', secret)
      .update(`${parts[0]}.${parts[1]}`)
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
    return { id: payload.sub, role: payload.role as AdminRole };
  } catch {
    return null;
  }
}

const ROLES_KEY = 'admin-roles';
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminPrincipal | undefined =>
    context.switchToHttp().getRequest<{ admin?: AdminPrincipal }>().admin,
);

@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly secret = loadAppConfig().adminJwtSecret;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      admin?: AdminPrincipal;
    }>();
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(
      request.headers.authorization ?? '',
    );
    const principal = match
      ? verifyAdminToken(match[1], this.secret)
      : null;
    if (!principal) throw new UnauthorizedException('ADMIN_AUTH_REQUIRED');
    request.admin = principal;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<{
      admin?: AdminPrincipal;
    }>();
    if (!request.admin || !required.includes(request.admin.role)) {
      throw new ForbiddenException('ADMIN_FORBIDDEN');
    }
    return true;
  }
}
