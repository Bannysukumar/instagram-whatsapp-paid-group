import { HttpError } from '../httpError.js';

export function errorHandler(error, _req, res, _next) {
  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, ...error.extra },
    });
    return;
  }
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'invalid_json', message: 'Request body must be JSON.' } });
    return;
  }
  if (error?.code === 'database_unavailable' || error?.name === 'MongoServerSelectionError') {
    res.status(503).json({
      error: { code: 'database_unavailable', message: 'The database is unavailable. Try again shortly.' },
    });
    return;
  }
  console.error('request_failed');
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
}
