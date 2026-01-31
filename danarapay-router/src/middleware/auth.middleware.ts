// src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Middleware to authenticate internal API calls from launcx-core
 */
export function internalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.header('X-Router-Api-Key');

  if (!apiKey) {
    logger.warn(
      { path: req.path, ip: req.ip },
      'Missing X-Router-Api-Key header'
    );
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing API key',
    });
    return;
  }

  if (apiKey !== config.routerApiKey) {
    logger.warn(
      { path: req.path, ip: req.ip },
      'Invalid X-Router-Api-Key'
    );
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid API key',
    });
    return;
  }

  next();
}

/**
 * Middleware for DanaRapay callback endpoints (no auth, but validate source)
 * In production, you might want to validate IP whitelist or signature
 */
export function callbackAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Log callback source for audit
  logger.info(
    {
      path: req.path,
      ip: req.ip,
      userAgent: req.header('User-Agent'),
      contentLength: req.header('Content-Length'),
    },
    'Incoming callback from DanaRapay'
  );

  // In production, you might want to:
  // 1. Validate IP whitelist
  // 2. Verify signature if DanaRapay provides one
  // For now, we accept all callbacks and rely on idempotency

  next();
}
