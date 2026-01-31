// src/routes/disbursement.routes.ts
import { Router, Request, Response } from 'express';
import { getDanarapayClient } from '../services/danarapay.client';
import {
  forwardToLauncxCore,
  buildDisbursementCreatedEvent,
} from '../services/forwarder.service';
import { internalAuth } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import { addToPollQueue } from '../workers/disbursement.worker';
import { CreateDisbursementRequest } from '../types/danarapay.types';

const router = Router();
const client = getDanarapayClient();

/**
 * POST /disbursement/create
 * Create a new disbursement (withdrawal)
 */
router.post('/create', internalAuth, async (req: Request, res: Response) => {
  const log = logger.child({ endpoint: 'disbursement/create' });

  try {
    const {
      partner_trx_id,
      recipient_bank,
      recipient_account,
      recipient_name,
      amount,
      notes,
    } = req.body;

    // Validate required fields
    if (!partner_trx_id || !recipient_bank || !recipient_account || !recipient_name || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: partner_trx_id, recipient_bank, recipient_account, recipient_name, amount',
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be greater than 0',
      });
    }

    const request: CreateDisbursementRequest = {
      partner_trx_id,
      recipient_bank,
      recipient_account,
      recipient_name,
      amount,
      notes,
    };

    log.info({ request }, 'Creating disbursement');

    const response = await client.createDisbursement(request);

    // Forward created event to launcx-core
    const event = buildDisbursementCreatedEvent(response, partner_trx_id);
    await forwardToLauncxCore(event);

    // Add to polling queue for status updates
    // Since DanaRapay doesn't have disbursement webhook, we poll
    addToPollQueue({
      remitId: response.remit_id,
      partnerTrxId: partner_trx_id,
      createdAt: new Date().toISOString(),
    });

    log.info(
      { remitId: response.remit_id, status: response.remit_status },
      'Disbursement created successfully'
    );

    return res.status(201).json({
      success: true,
      data: {
        remit_id: response.remit_id,
        partner_trx_id: response.partner_trx_id,
        recipient_bank: response.recipient_bank,
        recipient_bank_name: response.recipient_bank_name,
        recipient_account: response.recipient_account,
        recipient_name: response.recipient_name,
        amount: response.amount,
        admin_fee: response.admin_fee,
        status: response.remit_status,
        notes: response.notes,
        created: response.created,
      },
    });
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to create disbursement');
    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
});

/**
 * GET /disbursement/status/:partnerTrxId
 * Check disbursement status
 */
router.get('/status/:partnerTrxId', internalAuth, async (req: Request, res: Response) => {
  const log = logger.child({
    endpoint: 'disbursement/status',
    partnerTrxId: req.params.partnerTrxId,
  });

  try {
    const response = await client.getDisbursementStatus({
      partner_trx_id: req.params.partnerTrxId,
    });

    return res.json({
      success: true,
      data: {
        remit_id: response.remit_id,
        partner_trx_id: response.partner_trx_id,
        recipient_bank: response.recipient_bank,
        recipient_bank_name: response.recipient_bank_name,
        recipient_account: response.recipient_account,
        recipient_name: response.recipient_name,
        amount: response.amount,
        admin_fee: response.admin_fee,
        status: response.remit_status,
        notes: response.notes,
        created: response.created,
        updated: response.updated,
        completed_at: response.completed_at,
      },
    });
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to get disbursement status');
    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
});

/**
 * GET /disbursement/balance
 * Get disbursement balance
 */
router.get('/balance', internalAuth, async (_req: Request, res: Response) => {
  const log = logger.child({ endpoint: 'disbursement/balance' });

  try {
    const response = await client.getDisbursementBalance();

    return res.json({
      success: true,
      data: {
        balance: response.balance,
        available_balance: response.availableBalance,
        pending_balance: response.pendingBalance,
        freeze_balance: response.freezeBalance,
        hold_balance: response.holdBalance,
        timestamp: response.timeStamp,
      },
    });
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to get disbursement balance');
    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
});

export default router;
