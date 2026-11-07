export class HttpError extends Error {
  constructor(statusCode, code, message = code) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function assertRequest(condition, statusCode, code) {
  if (!condition) throw new HttpError(statusCode, code);
}
