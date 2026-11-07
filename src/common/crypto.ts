import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

export const createId = (): string => randomUUID();
export const createRandomToken = (bytes = 32): string =>
  randomBytes(bytes).toString('base64url');
export const sha256 = (value: string | Buffer): Buffer =>
  createHash('sha256').update(value).digest();

export function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
