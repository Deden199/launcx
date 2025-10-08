import { Request, Response, NextFunction } from 'express';
import { RedisCache } from '../config/redis';
import logger from '../logger';

/**
 * Cache middleware - caches response for GET requests
 */
export function cacheMiddleware(ttl: number = 300) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    try {
      const cacheKey = `cache:${req.originalUrl}`;

      // Try to get from cache
      const cachedData = await RedisCache.get<any>(cacheKey);

      if (cachedData) {
        logger.info(`[Cache] HIT: ${cacheKey}`);
        return res.json(cachedData);
      }

      logger.info(`[Cache] MISS: ${cacheKey}`);

      // Store original json method
      const originalJson = res.json.bind(res);

      // Override json method to cache response
      res.json = (body: any) => {
        // Cache the response
        RedisCache.set(cacheKey, body, ttl).catch((err) => {
          logger.error(`[Cache] Error caching ${cacheKey}:`, err);
        });

        // Send response
        return originalJson(body);
      };

      next();
    } catch (error) {
      logger.error('[Cache] Cache middleware error:', error);
      next();
    }
  };
}

/**
 * Invalidate cache by pattern
 */
export async function invalidateCache(pattern: string): Promise<void> {
  try {
    const deleted = await RedisCache.delPattern(pattern);
    logger.info(`[Cache] Invalidated ${deleted} keys matching pattern: ${pattern}`);
  } catch (error) {
    logger.error(`[Cache] Error invalidating cache pattern ${pattern}:`, error);
  }
}

/**
 * Rate limiting with Redis (more efficient than express-rate-limit)
 */
export function redisRateLimit(options: {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  handler?: (req: Request, res: Response) => void;
}) {
  const { windowMs, max, keyPrefix = 'ratelimit:', handler } = options;
  const windowSec = Math.floor(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identifier = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `${keyPrefix}${identifier}`;

      const count = await RedisCache.incr(key, windowSec);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
      res.setHeader('X-RateLimit-Reset', Date.now() + windowMs);

      if (count > max) {
        logger.warn(`[RateLimit] IP ${identifier} exceeded rate limit (${count}/${max})`);

        if (handler) {
          return handler(req, res);
        }

        return res.status(429).json({
          error: 'Too many requests, please try again later.',
          retryAfter: windowSec,
        });
      }

      next();
    } catch (error) {
      logger.error('[RateLimit] Redis rate limit error:', error);
      // Fallback: allow request if Redis fails
      next();
    }
  };
}

/**
 * Distributed lock middleware - prevents duplicate requests
 */
export function distributedLock(options: {
  keyGenerator: (req: Request) => string;
  ttl?: number;
  errorMessage?: string;
}) {
  const { keyGenerator, ttl = 10, errorMessage = 'Duplicate request detected' } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const lockKey = `lock:${keyGenerator(req)}`;

      const acquired = await RedisCache.acquireLock(lockKey, ttl);

      if (!acquired) {
        logger.warn(`[Lock] Failed to acquire lock: ${lockKey}`);
        return res.status(409).json({ error: errorMessage });
      }

      // Release lock after response
      res.on('finish', async () => {
        await RedisCache.releaseLock(lockKey);
      });

      next();
    } catch (error) {
      logger.error('[Lock] Distributed lock error:', error);
      // Fallback: allow request if Redis fails
      next();
    }
  };
}