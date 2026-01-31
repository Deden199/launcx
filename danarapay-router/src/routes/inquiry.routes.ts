// src/routes/inquiry.routes.ts
import { Router, Request, Response } from 'express';
import { getDanarapayClient } from '../services/danarapay.client';
import { internalAuth } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import { BANK_NAMES } from '../types/internal.types';

const router = Router();
const client = getDanarapayClient();

/**
 * POST /inquiry/account
 * Validate bank account (account inquiry)
 */
router.post('/account', internalAuth, async (req: Request, res: Response) => {
  const log = logger.child({ endpoint: 'inquiry/account' });

  try {
    const { bank_code, account_number } = req.body;

    // Validate required fields
    if (!bank_code || !account_number) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: bank_code, account_number',
      });
    }

    log.info({ bank_code, account_number }, 'Performing account inquiry');

    const response = await client.accountInquiry({
      bank_code,
      account_number,
    });

    log.info(
      { bank_code, account_number, account_name: response.account_name },
      'Account inquiry successful'
    );

    return res.json({
      success: true,
      data: {
        bank_code: response.bank_code,
        bank_name: response.bank_name,
        account_number: response.account_number,
        account_name: response.account_name,
        inquiry_id: response.inquiry_id,
      },
    });
  } catch (err: any) {
    log.error({ error: err.message }, 'Account inquiry failed');
    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
});

/**
 * GET /inquiry/banks
 * Get list of supported banks for disbursement
 */
router.get('/banks', internalAuth, (_req: Request, res: Response) => {
  const banks = Object.entries(BANK_NAMES).map(([code, name]) => ({
    code,
    name,
  }));

  return res.json({
    success: true,
    data: banks,
  });
});

export default router;
