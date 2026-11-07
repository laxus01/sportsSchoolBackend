import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const createId = () => randomUUID();
export const createRandomToken = (bytes = 32) =>
  randomBytes(bytes).toString('base64url');
export const sha256 = (value) =>
  createHash('sha256').update(value).digest();
export const sha256Hex = (value) =>
  createHash('sha256').update(value).digest('hex');
