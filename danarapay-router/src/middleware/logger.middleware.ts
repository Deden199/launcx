// src/middleware/logger.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Request logging middleware with request ID
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = uuidv4();
  const startTime = Date.now();

  // Attach request ID to request object
  (req as any).requestId = requestId;

  // Log request
  logger.info(
    {
      requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      ip: req.ip,
      userAgent: req.header('User-Agent'),
    },
    'Incoming request'
  );

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](
      {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
      },
      'Request completed'
    );
  });

  next();
}

/**
 * Get request ID from request object
 */
export function getRequestId(req: Request): string {
  return (req as any).requestId || 'unknown';
}
