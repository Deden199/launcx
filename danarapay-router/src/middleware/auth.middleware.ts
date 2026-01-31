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
 * Normalize IP address for comparison
 * Handles IPv6-mapped IPv4 addresses (::ffff:x.x.x.x)
 */
function normalizeIp(ip: string): string {
  // Remove IPv6 prefix if present
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

/**
 * Check if IP is in CIDR range
 * Supports both IPv4 CIDR (e.g., 10.0.0.0/8)
 */
function isIpInCidr(ip: string, cidr: string): boolean {
  const normalizedIp = normalizeIp(ip);
  
  // Check if it's a CIDR notation
  if (!cidr.includes('/')) {
    // Direct IP comparison
    return normalizedIp === cidr || normalizeIp(cidr) === normalizedIp;
  }

  const [range, bits] = cidr.split('/');
  const mask = parseInt(bits, 10);

  // Convert IPs to numeric for comparison
  const ipParts = normalizedIp.split('.').map(Number);
  const rangeParts = range.split('.').map(Number);

  if (ipParts.length !== 4 || rangeParts.length !== 4) {
    // Not valid IPv4, do direct comparison
    return normalizedIp === range;
  }

  // Convert to 32-bit integers
  const ipNum =
    (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const rangeNum =
    (rangeParts[0] << 24) |
    (rangeParts[1] << 16) |
    (rangeParts[2] << 8) |
    rangeParts[3];
  const maskNum = ~((1 << (32 - mask)) - 1);

  return (ipNum & maskNum) === (rangeNum & maskNum);
}

/**
 * Check if IP is whitelisted
 */
function isIpWhitelisted(clientIp: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) {
    // SECURE DEFAULT: Empty whitelist = DENY ALL
    return false;
  }

  return whitelist.some((entry) => isIpInCidr(clientIp, entry));
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
    const clientIp = getClientIp(req);
    logger.warn(
      {
        path: req.path,
        ip: clientIp,
        providedToken: tokenParam ? '[REDACTED]' : 'none',
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
  const whitelist = config.danarapayCallbackIps;

  // Check whitelist
  if (!isIpWhitelisted(clientIp, whitelist)) {
    logger.warn(
      {
        path: req.path,
        clientIp,
        normalizedIp: normalizeIp(clientIp),
        whitelistCount: whitelist.length,
        whitelistEmpty: whitelist.length === 0,
      },
      whitelist.length === 0
        ? 'Callback DENIED: IP whitelist is empty (secure default)'
        : 'Callback DENIED: IP not in whitelist'
    );
    res.status(403).json({
      success: false,
      error: 'Forbidden: IP not whitelisted',
    });
    return;
  }

  logger.debug(
    { clientIp, normalizedIp: normalizeIp(clientIp) },
    'IP whitelist check passed'
  );

  next();
}

/**
 * Combined callback auth middleware
 * Security layers:
 * 1. Verify IP whitelist (from DANARAPAY_IP_WHITELIST env)
 * 2. Verify URL path token (from CALLBACK_SECRET_TOKEN env)
 * 3. Audit logging
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
      normalizedIp: normalizeIp(clientIp),
      userAgent: req.header('User-Agent'),
      contentLength: req.header('Content-Length'),
    },
    'Incoming callback request'
  );

  // Layer 1: Verify IP whitelist
  verifyDanarapayIp(req, res, (err) => {
    if (err) return;
    // res already sent if IP check failed
    if (res.headersSent) return;

    // Layer 2: Verify URL token
    verifyCallbackToken(req, res, (err2) => {
      if (err2) return;
      if (res.headersSent) return;

      // Both checks passed
      logger.info(
        { clientIp, path: req.path },
        'Callback authentication successful'
      );
      next();
    });
  });
}
