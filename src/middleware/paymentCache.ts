import { Request, Response, NextFunction } from 'express';
import { RedisCache } from '../config/redis';
import logger from '../logger';

/**
 * Cache partner client data (reduces DB queries)
 */
export async function cachePartnerClient(apiKey: string) {
  const cacheKey = `partner:${apiKey}`;
  return await RedisCache.getOrSet(
    cacheKey,
    async () => {
      // This will be filled by actual DB query in the route
      return null;
    },
    300 // 5 minutes TTL
  );
}

/**
 * Cache sub-merchant data
 */
export async function cacheSubMerchant(subMerchantId: string) {
  const cacheKey = `submerchant:${subMerchantId}`;
  return await RedisCache.getOrSet(
    cacheKey,
    async () => {
      return null;
    },
    600 // 10 minutes TTL
  );
}

/**
 * Prevent duplicate order creation (idempotency)
 */
export function preventDuplicateOrder() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { playerId, price } = req.body;
      const apiKey = req.headers['x-api-key'] as string;

      if (!playerId || !price || !apiKey) {
        return next();
      }

      // Create idempotency key
      const idempotencyKey = `order:${apiKey}:${playerId}:${price}`;

      // Check if order was recently created (within 60 seconds)
      const recentOrder = await RedisCache.get<any>(idempotencyKey);

      if (recentOrder) {
        logger.warn(`[Idempotency] Duplicate order detected: ${idempotencyKey}`);
        return res.status(200).json({
          success: true,
          data: recentOrder,
          message: 'Order already created',
        });
      }

      // Store flag to mark order creation
      res.on('finish', async () => {
        if (res.statusCode === 201 && (res as any).orderData) {
          await RedisCache.set(idempotencyKey, (res as any).orderData, 60);
        }
      });

      next();
    } catch (error) {
      logger.error('[Idempotency] Error in duplicate prevention:', error);
      next();
    }
  };
}

/**
 * Cache clearing utility
 */
export async function clearPaymentCache(patterns: string[]) {
  for (const pattern of patterns) {
    await RedisCache.delPattern(pattern);
  }
}