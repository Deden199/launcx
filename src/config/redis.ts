import Redis from 'ioredis';
import logger from '../logger';

// Redis connection configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB) || 0,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: true,
  lazyConnect: false,
};

// Create Redis client
export const redisClient = new Redis(redisConfig);

// Connection event handlers
redisClient.on('connect', () => {
  logger.info('[Redis] Connected to Redis server');
});

redisClient.on('ready', () => {
  logger.info('[Redis] Redis client is ready');
});

redisClient.on('error', (err) => {
  logger.error('[Redis] Redis client error:', err);
});

redisClient.on('close', () => {
  logger.warn('[Redis] Redis connection closed');
});

redisClient.on('reconnecting', () => {
  logger.info('[Redis] Reconnecting to Redis...');
});

// Helper functions for caching
export class RedisCache {
  /**
   * Get cached value
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const value = await redisClient.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error(`[Redis] Error getting key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set cached value with TTL (in seconds)
   */
  static async set(key: string, value: any, ttl: number = 300): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      await redisClient.setex(key, ttl, serialized);
      return true;
    } catch (error) {
      logger.error(`[Redis] Error setting key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete cached value
   */
  static async del(key: string): Promise<boolean> {
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      logger.error(`[Redis] Error deleting key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  static async delPattern(pattern: string): Promise<number> {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length === 0) return 0;
      return await redisClient.del(...keys);
    } catch (error) {
      logger.error(`[Redis] Error deleting pattern ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Check if key exists
   */
  static async exists(key: string): Promise<boolean> {
    try {
      const result = await redisClient.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`[Redis] Error checking key ${key}:`, error);
      return false;
    }
  }

  /**
   * Increment counter (for rate limiting)
   */
  static async incr(key: string, ttl?: number): Promise<number> {
    try {
      const value = await redisClient.incr(key);
      if (ttl && value === 1) {
        await redisClient.expire(key, ttl);
      }
      return value;
    } catch (error) {
      logger.error(`[Redis] Error incrementing key ${key}:`, error);
      return 0;
    }
  }

  /**
   * Get or set cached value (cache-aside pattern)
   */
  static async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 300
  ): Promise<T | null> {
    try {
      // Try to get from cache
      const cached = await this.get<T>(key);
      if (cached !== null) {
        return cached;
      }

      // Fetch from source
      const value = await fetcher();
      if (value !== null && value !== undefined) {
        await this.set(key, value, ttl);
      }

      return value;
    } catch (error) {
      logger.error(`[Redis] Error in getOrSet for key ${key}:`, error);
      // Fallback to fetcher if Redis fails
      try {
        return await fetcher();
      } catch (fetchError) {
        logger.error(`[Redis] Fetcher also failed for key ${key}:`, fetchError);
        return null;
      }
    }
  }

  /**
   * Set value with NX (only if not exists) - useful for distributed locks
   */
  static async setnx(key: string, value: any, ttl: number = 300): Promise<boolean> {
    try {
      const result = await redisClient.set(key, JSON.stringify(value), 'EX', ttl, 'NX');
      return result === 'OK';
    } catch (error) {
      logger.error(`[Redis] Error in setnx for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Acquire distributed lock
   */
  static async acquireLock(lockKey: string, ttl: number = 10): Promise<boolean> {
    return await this.setnx(lockKey, Date.now(), ttl);
  }

  /**
   * Release distributed lock
   */
  static async releaseLock(lockKey: string): Promise<boolean> {
    return await this.del(lockKey);
  }
}

export default redisClient;