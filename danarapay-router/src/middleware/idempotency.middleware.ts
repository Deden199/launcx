// src/middleware/idempotency.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import {
  acquireLock,
  releaseLock,
  isProcessed,
  markProcessed,
  generateIdempotencyKey,
} from '../utils/redis';
import { EventType } from '../types/internal.types';

export interface IdempotencyOptions {
  provider: string;
  eventType: EventType;
  getUniqueId: (req: Request) => string;
}

/**
 * Middleware factory for idempotent callback processing
 * Uses Redis SET NX EX for atomic distributed lock
 */
export function idempotentCallback(options: IdempotencyOptions) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const { provider, eventType, getUniqueId } = options;
    
    let uniqueId: string;
    try {
      uniqueId = getUniqueId(req);
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Failed to extract unique ID');
      res.status(400).json({
        success: false,
        error: 'Invalid request: cannot extract unique ID',
      });
      return;
    }

    const idempotencyKey = generateIdempotencyKey(provider, eventType, uniqueId);
    const lockKey = `lock:${idempotencyKey}`;

    const log = logger.child({
      idempotencyKey,
      provider,
      eventType,
      uniqueId,
    });

    // Check if already processed
    const alreadyProcessed = await isProcessed(idempotencyKey);
    if (alreadyProcessed) {
      log.info('Callback already processed (idempotent)');
      res.status(200).json({
        success: true,
        message: 'Already processed',
        idempotent: true,
      });
      return;
    }

    // Try to acquire lock (atomic SET NX EX)
    const lockAcquired = await acquireLock(lockKey);
    if (!lockAcquired) {
      log.warn('Failed to acquire lock (concurrent processing)');
      res.status(409).json({
        success: false,
        error: 'Concurrent processing in progress',
        retry: true,
      });
      return;
    }

    log.info('Lock acquired, processing callback');

    // Store lock key and idempotency key in request for later use
    (req as any)._idempotencyKey = idempotencyKey;
    (req as any)._lockKey = lockKey;
    (req as any)._idempotencyLog = log;

    // Add cleanup on response finish
    res.on('finish', async () => {
      try {
        // Mark as processed only on success (2xx)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          await markProcessed(idempotencyKey);
          log.info('Marked as processed');
        }
        // Always release lock
        await releaseLock(lockKey);
        log.debug('Lock released');
      } catch (err) {
        log.error({ error: (err as Error).message }, 'Failed to cleanup idempotency');
      }
    });

    next();
  };
}

/**
 * Helper to get idempotency log from request
 */
export function getIdempotencyLog(req: Request) {
  return (req as any)._idempotencyLog || logger;
}
