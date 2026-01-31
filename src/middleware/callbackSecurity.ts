// File: src/middleware/callbackSecurity.ts
// Gate 4: Callback Security Middleware for DanaRapay
// Protects callback endpoints with token verification and optional IP whitelist

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../logger';

// Environment variables for callback security
const CALLBACK_SECRET_TOKEN = process.env.CALLBACK_SECRET_TOKEN || '';
const DANARAPAY_IP_WHITELIST = (process.env.DANARAPAY_IP_WHITELIST || '').split(',').filter(Boolean);

// DanaRapay known IPs (staging and production)
// Update these based on DanaRapay documentation or use DANARAPAY_IP_WHITELIST env var
const DANARAPAY_DEFAULT_IPS = [
  // Localhost for testing
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
];

/**
 * Verify callback request authenticity
 * 
 * Security layers:
 * 1. Token verification (X-Callback-Token header or query param)
 * 2. IP whitelist (optional, enabled via CALLBACK_ALLOWED_IPS)
 * 3. Request signature (if provided via X-Signature header)
 */
export function callbackSecurityMiddleware(options?: {
  requireToken?: boolean;
  requireIpWhitelist?: boolean;
  allowedIps?: string[];
}) {
  const {
    requireToken = true,
    requireIpWhitelist = false, // Disabled by default for backward compatibility
    allowedIps = [...DANARAPAY_IPS, ...CALLBACK_ALLOWED_IPS],
  } = options || {};

  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const clientIp = getClientIp(req);
    
    // Log callback attempt for audit
    logger.info('[Callback Security] Request received', {
      path: req.path,
      method: req.method,
      clientIp,
      hasToken: !!req.header('X-Callback-Token'),
      hasSignature: !!req.header('X-Signature'),
    });

    // 1. IP Whitelist Check (if enabled)
    if (requireIpWhitelist && allowedIps.length > 0) {
      const isAllowedIp = allowedIps.some(ip => {
        // Support CIDR notation in future
        return ip === clientIp || clientIp.endsWith(ip);
      });

      if (!isAllowedIp) {
        logger.warn('[Callback Security] BLOCKED: IP not in whitelist', {
          clientIp,
          allowedIps: allowedIps.slice(0, 5), // Log first 5 for security
          path: req.path,
        });
        return res.status(403).json({
          success: false,
          error: 'IP not allowed',
          code: 'IP_BLOCKED',
        });
      }
    }

    // 2. Token Verification - FAIL-CLOSED behavior
    if (requireToken) {
      // CRITICAL: If token is required but not configured, REJECT request
      // This prevents fail-open scenario where missing config allows all callbacks
      if (!CALLBACK_SECRET_TOKEN) {
        logger.error('[Callback Security] MISCONFIGURED: requireToken=true but CALLBACK_SECRET_TOKEN not set', {
          clientIp,
          path: req.path,
        });
        return res.status(500).json({
          success: false,
          error: 'Callback security misconfigured',
          code: 'SECURITY_MISCONFIGURED',
        });
      }

      const providedToken = req.header('X-Callback-Token') || 
                           req.query.token as string ||
                           '';

      if (!providedToken) {
        logger.warn('[Callback Security] BLOCKED: Missing callback token', {
          clientIp,
          path: req.path,
        });
        return res.status(401).json({
          success: false,
          error: 'Missing callback token',
          code: 'TOKEN_MISSING',
        });
      }

      // Check token length first to avoid timing attack via length
      if (providedToken.length !== CALLBACK_SECRET_TOKEN.length) {
        logger.warn('[Callback Security] BLOCKED: Invalid callback token', {
          clientIp,
          path: req.path,
          tokenPrefix: providedToken.substring(0, 8) + '...',
        });
        return res.status(401).json({
          success: false,
          error: 'Invalid callback token',
          code: 'TOKEN_INVALID',
        });
      }

      // Constant-time comparison to prevent timing attacks
      const isValidToken = crypto.timingSafeEqual(
        Buffer.from(providedToken),
        Buffer.from(CALLBACK_SECRET_TOKEN)
      );

      if (!isValidToken) {
        logger.warn('[Callback Security] BLOCKED: Invalid callback token', {
          clientIp,
          path: req.path,
          tokenPrefix: providedToken.substring(0, 8) + '...',
        });
        return res.status(401).json({
          success: false,
          error: 'Invalid callback token',
          code: 'TOKEN_INVALID',
        });
      }
    }

    // 3. Optional HMAC Signature Verification
    const signature = req.header('X-Signature');
    const timestamp = req.header('X-Timestamp');
    
    if (signature && timestamp && CALLBACK_SECRET_TOKEN) {
      const rawBody = (req as any).rawBody?.toString() || JSON.stringify(req.body);
      const payload = `${timestamp}:${rawBody}`;
      
      const expectedSignature = crypto
        .createHmac('sha256', CALLBACK_SECRET_TOKEN)
        .update(payload)
        .digest('hex');

      const isValidSignature = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      if (!isValidSignature) {
        logger.warn('[Callback Security] BLOCKED: Invalid signature', {
          clientIp,
          path: req.path,
        });
        return res.status(401).json({
          success: false,
          error: 'Invalid signature',
          code: 'SIGNATURE_INVALID',
        });
      }

      logger.info('[Callback Security] Signature verified', {
        clientIp,
        path: req.path,
      });
    }

    // Log successful authentication
    logger.info('[Callback Security] Request authorized', {
      clientIp,
      path: req.path,
      durationMs: Date.now() - startTime,
    });

    next();
  };
}

/**
 * Get real client IP from request
 * Handles X-Forwarded-For and other proxy headers
 */
function getClientIp(req: Request): string {
  const forwardedFor = req.header('X-Forwarded-For');
  if (forwardedFor) {
    // Get first IP in the chain (original client)
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIp = req.header('X-Real-IP');
  if (realIp) {
    return realIp.trim();
  }
  
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Lightweight version - only logs, doesn't block
 * Use this for gradual rollout or monitoring
 */
export function callbackAuditMiddleware(req: Request, res: Response, next: NextFunction) {
  const clientIp = getClientIp(req);
  
  logger.info('[Callback Audit] Request received', {
    path: req.path,
    method: req.method,
    clientIp,
    hasToken: !!req.header('X-Callback-Token'),
    hasSignature: !!req.header('X-Signature'),
    userAgent: req.header('User-Agent'),
    contentType: req.header('Content-Type'),
  });

  next();
}

export default callbackSecurityMiddleware;
