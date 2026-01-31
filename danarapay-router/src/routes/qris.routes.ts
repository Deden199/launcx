// src/routes/qris.routes.ts
import { Router, Request, Response } from 'express';
import { getDanarapayClient } from '../services/danarapay.client';
import {
  forwardToLauncxCore,
  buildQrisCreatedEvent,
} from '../services/forwarder.service';
import { internalAuth } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import { CreateQrisRequest } from '../types/danarapay.types';

const router = Router();
const client = getDanarapayClient();

/**
 * POST /qris/create
 * Create a new QRIS payment transaction
 */
router.post('/create', internalAuth, async (req: Request, res: Response) => {
  const log = logger.child({ endpoint: 'qris/create' });

  try {
    const {
      partner_user_id,
      partner_trx_id,
      amount,
      need_frontend = false,
      sender_email,
      expiration_minutes,
    } = req.body;

    // Validate required fields
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid amount',
      });
    }

    const request: CreateQrisRequest = {
      partner_user_id,
      partner_trx_id,
      need_frontend,
      sender_email,
      receive_amount: amount,
      list_enable_payment_method: 'QRIS',
      list_enable_sof: 'QRIS',
      trx_expiration_time: expiration_minutes
        ? String(expiration_minutes)
        : undefined,
    };

    log.info({ request }, 'Creating QRIS transaction');

    const response = await client.createQris(request);

    // Forward to launcx-core
    const event = buildQrisCreatedEvent(
      response,
      partner_trx_id || response.partner_trx_id
    );
    await forwardToLauncxCore(event);

    log.info(
      { trxId: response.trx_id, partnerTrxId: response.partner_trx_id },
      'QRIS transaction created successfully'
    );

    return res.status(201).json({
      success: true,
      data: {
        trx_id: response.trx_id,
        partner_trx_id: response.partner_trx_id,
        amount: response.receive_amount,
        expiration_time: response.trx_expiration_time,
        qris_url: response.payment_info?.qris_url,
        checkout_url: response.payment_info?.payment_checkout_url,
        payment_method: response.payment_method,
      },
    });
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to create QRIS transaction');
    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
});

/**
 * GET /qris/status/:partnerTrxId
 * Check QRIS transaction status
 */
router.get('/status/:partnerTrxId', internalAuth, async (req: Request, res: Response) => {
  const log = logger.child({
    endpoint: 'qris/status',
    partnerTrxId: req.params.partnerTrxId,
  });

  try {
    const response = await client.getQrisStatus(req.params.partnerTrxId);

    return res.json({
      success: true,
      data: {
        trx_id: response.trx_id,
        partner_trx_id: response.partner_trx_id,
        amount: response.receive_amount,
        status: response.payment_status,
        expiration_time: response.trx_expiration_time,
        payment_received_time: response.payment_received_time,
        settlement_time: response.settlement_time,
        settlement_status: response.settlement_status,
        payment_method: response.payment_method,
        sender_bank: response.sender_bank,
        payment_reference_number: response.payment_info?.payment_reference_number,
      },
    });
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to get QRIS status');
    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
});

export default router;
