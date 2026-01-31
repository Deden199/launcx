// src/utils/redis.ts
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.error({ times }, 'Redis connection failed after retries');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });

    redisClient.on('error', (err) => {
      logger.error({ error: err.message }, 'Redis connection error');
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected');
    });
  }
  return redisClient;
}

/**
 * Atomic distributed lock using SET NX EX
 * Returns true if lock acquired, false if already locked
 */
export async function acquireLock(
  lockKey: string,
  ttlSeconds: number = config.idempotency.lockTtlSeconds
): Promise<boolean> {
  const redis = getRedis();
  const result = await redis.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

/**
 * Release lock
 */
export async function releaseLock(lockKey: string): Promise<void> {
  const redis = getRedis();
  await redis.del(lockKey);
}

/**
 * Check if idempotency key exists (already processed)
 */
export async function isProcessed(idempotencyKey: string): Promise<boolean> {
  const redis = getRedis();
  const exists = await redis.exists(`processed:${idempotencyKey}`);
  return exists === 1;
}

/**
 * Mark as processed with TTL
 */
export async function markProcessed(
  idempotencyKey: string,
  ttlSeconds: number = 86400 // 24 hours
): Promise<void> {
  const redis = getRedis();
  await redis.set(`processed:${idempotencyKey}`, '1', 'EX', ttlSeconds);
}

/**
 * Generate idempotency key for callback events
 */
export function generateIdempotencyKey(
  provider: string,
  eventType: string,
  uniqueId: string
): string {
  return `${provider}:${eventType}:${uniqueId}`;
}

/**
 * Graceful shutdown
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}
