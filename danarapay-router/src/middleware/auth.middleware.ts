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
 * DanaRapay official IP whitelist
 * Update this list based on DanaRapay's official documentation
 */
const DANARAPAY_IP_WHITELIST: string[] = [
  // DanaRapay Production IPs (get from DanaRapay team)
  '103.150.60.52',
  '103.150.60.53',
  '103.150.60.54',
  '103.150.60.55',
  // DanaRapay Staging IPs
  '103.150.60.56',
  '103.150.60.57',
  // Localhost for testing
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
];

/**
 * Get real client IP (handles proxy)
 */
function getClientIp(req: Request): string {
  const forwarded = req.header('X-Forwarded-For');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.header('X-Real-IP');
  if (realIp) {
    return realIp;
  }
  return req.ip || req.socket.remoteAddress || '';
}

/**
 * Verify callback token from URL path
 */
export function verifyCallbackToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const tokenParam = req.params.token;
  const expectedToken = config.callbackSecretToken;

  if (!expectedToken) {
    logger.error('CALLBACK_SECRET_TOKEN not configured');
    res.status(500).json({
      success: false,
      error: 'Server misconfiguration',
    });
    return;
  }

  if (!tokenParam || tokenParam !== expectedToken) {
    logger.warn(
      {
        path: req.path,
        ip: getClientIp(req),
        providedToken: tokenParam ? '***' : 'none',
      },
      'Invalid callback token'
    );
    res.status(403).json({
      success: false,
      error: 'Forbidden: Invalid callback token',
    });
    return;
  }

  next();
}

/**
 * Verify DanaRapay IP whitelist
 */
export function verifyDanarapayIp(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const clientIp = getClientIp(req);
  
  // Check against whitelist
  const isWhitelisted = DANARAPAY_IP_WHITELIST.some((ip) => {
    // Handle IPv6 mapped IPv4
    return clientIp === ip || 
           clientIp === `::ffff:${ip}` || 
           clientIp.endsWith(ip);
  });

  // Also check env-configured IPs
  const extraIps = config.danarapayCallbackIps;
  const isExtraWhitelisted = extraIps.some((ip) => {
    return clientIp === ip || 
           clientIp === `::ffff:${ip}` || 
           clientIp.endsWith(ip);
  });

  if (!isWhitelisted && !isExtraWhitelisted) {
    logger.warn(
      {
        path: req.path,
        clientIp,
        whitelistedIps: [...DANARAPAY_IP_WHITELIST, ...extraIps],
      },
      'Callback from non-whitelisted IP'
    );
    res.status(403).json({
      success: false,
      error: 'Forbidden: IP not whitelisted',
    });
    return;
  }

  next();
}

/**
 * Combined callback auth middleware
 * 1. Verify IP whitelist
 * 2. Log callback details for audit
 */
export function callbackAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const clientIp = getClientIp(req);

  // Log callback source for audit
  logger.info(
    {
      path: req.path,
      clientIp,
      userAgent: req.header('User-Agent'),
      contentLength: req.header('Content-Length'),
    },
    'Incoming callback from DanaRapay'
  );

  // Verify IP
  verifyDanarapayIp(req, res, (err) => {
    if (err) return;
    // IP verified, continue
    next();
  });
}
