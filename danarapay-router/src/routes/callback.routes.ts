// src/routes/callback.routes.ts
import { Router, Request, Response } from 'express';
import { callbackAuth } from '../middleware/auth.middleware';
import {
  idempotentCallback,
  getIdempotencyLog,
} from '../middleware/idempotency.middleware';
import {
  forwardToLauncxCore,
  buildVaCallbackEvent,
  buildQrisCallbackEvent,
} from '../services/forwarder.service';
import { logger } from '../utils/logger';
import { VaCallbackPayload, QrisCallbackPayload } from '../types/danarapay.types';
import { config } from '../config';
import { getDanarapayClient } from '../services/danarapay.client';

const router = Router();

/**
 * POST /callback/va
 * Handle VA payment callback from DanaRapay
 */
router.post(
  '/va',
  callbackAuth,
  idempotentCallback({
    provider: 'DANARAPAY',
    eventType: 'VA',
    getUniqueId: (req) => {
      const body = req.body as VaCallbackPayload;
      // Use trx_id as unique identifier (per transaction)
      // or combine va_id + trx_id for uniqueness
      return body.trx_id || body.id || body.partner_trx_id;
    },
  }),
  async (req: Request, res: Response) => {
    const log = getIdempotencyLog(req);
    const callback = req.body as VaCallbackPayload;

    try {
      log.info({ callback }, 'Processing VA callback');

      // Build and forward event to launcx-core
      const event = buildVaCallbackEvent(callback);
      await forwardToLauncxCore(event);

      log.info(
        {
          vaNumber: callback.va_number,
          status: callback.va_status,
          amount: callback.amount,
        },
        'VA callback processed and forwarded'
      );

      return res.json({
        success: true,
        message: 'Callback processed',
      });
    } catch (err: any) {
      log.error({ error: err.message }, 'Failed to process VA callback');
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  }
);

/**
 * POST /callback/qris
 * Handle QRIS payment callback from DanaRapay
 */
router.post(
  '/qris',
  callbackAuth,
  idempotentCallback({
    provider: 'DANARAPAY',
    eventType: 'QRIS',
    getUniqueId: (req) => {
      const body = req.body as QrisCallbackPayload;
      // Use trx_id as unique identifier
      // Also consider settlement_status for 2nd callback
      return `${body.trx_id}:${body.settlement_status || 'payment'}`;
    },
  }),
  async (req: Request, res: Response) => {
    const log = getIdempotencyLog(req);
    const callback = req.body as QrisCallbackPayload;

    try {
      log.info({ callback }, 'Processing QRIS callback');

      // Build and forward event to launcx-core
      const event = buildQrisCallbackEvent(callback);
      await forwardToLauncxCore(event);

      log.info(
        {
          trxId: callback.trx_id,
          status: callback.payment_status,
          settlementStatus: callback.settlement_status,
          amount: callback.receive_amount,
        },
        'QRIS callback processed and forwarded'
      );

      return res.json({
        success: true,
        message: 'Callback processed',
      });
    } catch (err: any) {
      log.error({ error: err.message }, 'Failed to process QRIS callback');
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  }
);

/**
 * POST /callback/simulate/va
 * Simulate VA callback (staging only)
 */
router.post('/simulate/va', async (req: Request, res: Response) => {
  if (config.isProduction) {
    return res.status(403).json({
      success: false,
      error: 'Simulation not available in production',
    });
  }

  const { va_id, amount } = req.body;
  if (!va_id) {
    return res.status(400).json({
      success: false,
      error: 'Missing va_id',
    });
  }

  try {
    const client = getDanarapayClient();
    await client.simulateVaCallback(va_id, amount);
    logger.info({ va_id, amount }, 'VA callback simulation triggered');
    return res.json({ success: true, message: 'Simulation triggered' });
  } catch (err: any) {
    logger.error({ error: err.message }, 'VA callback simulation failed');
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /callback/simulate/qris
 * Simulate QRIS callback (staging only)
 */
router.post('/simulate/qris', async (req: Request, res: Response) => {
  if (config.isProduction) {
    return res.status(403).json({
      success: false,
      error: 'Simulation not available in production',
    });
  }

  const { trx_id } = req.body;
  if (!trx_id) {
    return res.status(400).json({
      success: false,
      error: 'Missing trx_id',
    });
  }

  try {
    const client = getDanarapayClient();
    await client.simulateQrisCallback(trx_id);
    logger.info({ trx_id }, 'QRIS callback simulation triggered');
    return res.json({ success: true, message: 'Simulation triggered' });
  } catch (err: any) {
    logger.error({ error: err.message }, 'QRIS callback simulation failed');
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
