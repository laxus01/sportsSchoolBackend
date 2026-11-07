import { generateKeyPairSync, verify as verifySignature } from 'node:crypto';
import { AppConfig } from '../src/config/app-config';
import { issueLicense } from '../src/licensing/crypto/license-jws';

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

const config: AppConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3001,
  dbHost: 'localhost',
  dbPort: 3306,
  dbUsername: 'test',
  dbPassword: 'test',
  dbDatabase: 'test',
  dbSsl: false,
  allowedOrigins: [],
  adminJwtSecret: 'test-secret-that-is-long-enough-for-this-suite',
  licenseIssuer: 'https://licenses.example.test',
  licenseAudience: 'SPORTS_SCHOOL',
  licenseSigningKeyId: 'test-key',
  licenseSigningPrivateKeyBase64: '',
  activationCodeTtlHours: 72,
  challengeTtlSeconds: 300,
};

describe('license JWS', () => {
  it('signs a subscription with the capped offline expiry', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = issueLicense({
      config,
      privateKey,
      license: {
        id: 'license-id',
        schoolId: 'school-id',
        licenseType: 'SUBSCRIPTION',
        status: 'ACTIVE',
        schoolStatus: 'ACTIVE',
        paidThrough: '2026-12-02T05:00:00.000Z',
        graceUntil: '2026-12-12T05:00:00.000Z',
        offlineDays: 30,
      },
      installation: {
        id: 'installation-id',
        status: 'ACTIVE',
        licenseRevision: 4,
        publicKeyThumbprint: 'device-thumbprint',
      },
      now: new Date('2026-11-06T12:00:00.000Z'),
    });
    const [headerPart, claimsPart, signaturePart] = signed.token.split('.');
    const header = decode(headerPart);
    const claims = decode(claimsPart);
    expect(header).toEqual({ alg: 'EdDSA', kid: 'test-key', typ: 'JWT' });
    expect(claims.licenseType).toBe('SUBSCRIPTION');
    expect(claims.exp).toBe(Date.parse(claims.offlineUntil) / 1000);
    expect(
      verifySignature(
        null,
        Buffer.from(`${headerPart}.${claimsPart}`),
        publicKey,
        Buffer.from(signaturePart, 'base64url'),
      ),
    ).toBe(true);
  });

  it('issues a perpetual license without any expiration claims', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const signed = issueLicense({
      config,
      privateKey,
      license: {
        id: 'license-id',
        schoolId: 'school-id',
        licenseType: 'PERPETUAL',
        status: 'ACTIVE',
        schoolStatus: 'ACTIVE',
      },
      installation: {
        id: 'installation-id',
        status: 'ACTIVE',
        licenseRevision: 1,
        publicKeyThumbprint: 'device-thumbprint',
      },
      now: new Date('2026-11-06T12:00:00.000Z'),
    });
    const claims = decode(signed.token.split('.')[1]);
    expect(claims.licenseType).toBe('PERPETUAL');
    expect(claims.status).toBe('ACTIVE');
    expect(claims).not.toHaveProperty('exp');
    expect(claims).not.toHaveProperty('offlineUntil');
    expect(claims).not.toHaveProperty('paidThrough');
  });

  it('refuses to issue a token while the license is pending payment', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    expect(() =>
      issueLicense({
        config,
        privateKey,
        license: {
          id: 'license-id',
          schoolId: 'school-id',
          licenseType: 'PERPETUAL',
          status: 'PENDING_PAYMENT',
          schoolStatus: 'ACTIVE',
        },
        installation: {
          id: 'installation-id',
          status: 'ACTIVE',
          licenseRevision: 0,
          publicKeyThumbprint: 'device-thumbprint',
        },
      }),
    ).toThrow('Cannot issue a license before payment confirmation');
  });
});
