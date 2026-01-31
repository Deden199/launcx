// src/routes/va.routes.ts
import { Router, Request, Response } from 'express';
import { getDanarapayClient } from '../services/danarapay.client';
import {
  forwardToLauncxCore,
  buildVaCreatedEvent,
} from '../services/forwarder.service';
import { internalAuth } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import { CreateVaRequest, UpdateVaRequest, VA_BANK_CODES } from '../types/danarapay.types';

const router = Router();
const client = getDanarapayClient();

/**
 * POST /va/create
 * Create a new Virtual Account
 */
router.post('/create', internalAuth, async (req: Request, res: Response) => {
  const log = logger.child({ endpoint: 'va/create' });

  try {
    const body: CreateVaRequest = req.body;

    // Validate required fields
    if (!body.partner_user_id || !body.bank_code || !body.username_display) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: partner_user_id, bank_code, username_display',
      });
    }

    // Validate bank code
    const validBankCodes = Object.values(VA_BANK_CODES);
    if (!validBankCodes.includes(body.bank_code as any)) {
      return res.status(400).json({
        success: false,
        error: `Invalid bank_code. Valid values: ${validBankCodes.join(', ')}`,
      });
    }

    log.info({ body }, 'Creating VA');

    const response = await client.createVa(body);

    // Forward to launcx-core
    const event = buildVaCreatedEvent(
      response,
      body.partner_trx_id || response.partner_trx_id
    );
    await forwardToLauncxCore(event);

    log.info({ vaId: response.id, vaNumber: response.va_number }, 'VA created successfully');

    return res.status(201).json({
      success: true,
      data: {
        id: response.id,
        va_number: response.va_number,
        bank_code: response.bank_code,
        amount: response.amount,
        partner_user_id: response.partner_user_id,
        partner_trx_id: response.partner_trx_id,
        is_open: response.is_open,
        is_single_use: response.is_single_use,
        expiration_time: response.expiration_time,
        trx_expiration_time: response.trx_expiration_time,
        va_status: response.va_status,
        username_display: response.username_display,
      },
    });
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to create VA');
    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
});

/**
 * GET /va/:id
 * Get VA information
 */
router.get('/:id', internalAuth, async (req: Request, res: Response) => {
  const log = logger.child({ endpoint: 'va/info', vaId: req.params.id });

  try {
    const response = await client.getVaInfo(req.params.id);

    return res.json({
      success: true,
      data: response,
    });
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to get VA info');
    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
});

/**
 * PUT /va/:id
 * Update VA
 */
router.put('/:id', internalAuth, async (req: Request, res: Response) => {
  const log = logger.child({ endpoint: 'va/update', vaId: req.params.id });

  try {
    const body: UpdateVaRequest = req.body;
    const response = await client.updateVa(req.params.id, body);

    log.info({ vaId: req.params.id }, 'VA updated successfully');

    return res.json({
      success: true,
      data: response,
    });
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to update VA');
    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
});

/**
 * DELETE /va/:id
 * Deactivate VA
 */
router.delete('/:id', internalAuth, async (req: Request, res: Response) => {
  const log = logger.child({ endpoint: 'va/deactivate', vaId: req.params.id });

  try {
    const response = await client.deactivateVa(req.params.id);

    log.info({ vaId: req.params.id }, 'VA deactivated successfully');

    return res.json({
      success: true,
      data: response,
    });
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to deactivate VA');
    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
});

/**
 * GET /va/banks/list
 * Get supported bank codes
 */
router.get('/banks/list', internalAuth, (_req: Request, res: Response) => {
  return res.json({
    success: true,
    data: Object.entries(VA_BANK_CODES).map(([name, code]) => ({
      code,
      name,
    })),
  });
});

export default router;
