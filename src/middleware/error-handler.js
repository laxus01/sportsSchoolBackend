import { HttpError } from '../utils/http-error.js';

export function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, 'NOT_FOUND'));
}

export function errorHandler(error, req, res, _next) {
  const statusCode =
    error instanceof HttpError
      ? error.statusCode
      : error?.type === 'entity.parse.failed'
        ? 400
        : error?.code === '23505'
          ? 409
          : 500;
  const code =
    error instanceof HttpError
      ? error.code
      : error?.type === 'entity.parse.failed'
        ? 'INVALID_JSON'
        : error?.code === '23505'
          ? 'DATA_CONFLICT'
          : 'INTERNAL_ERROR';

  if (statusCode >= 500) {
    console.error({
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      code,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  res.status(statusCode).json({
    error: code,
    requestId: req.requestId,
  });
}
