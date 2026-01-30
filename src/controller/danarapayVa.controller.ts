// File: src/controller/danarapayVa.controller.ts
// DanaRpay VA Aggregator Controller - Based on official API docs v1.2.4

import { Request, Response } from 'express';
import logger from '../logger';
import { prisma } from '../core/prisma';
import { config } from '../config';
import {
  DanarapayClient,
  DanarapayVaCallbackPayload,
  CreateVaRequest,
  UpdateVaRequest,
  VA_BANK_CODES,
} from '../service/danarapayClient';

// ===================== CLIENT INSTANCE =====================

let danarapayClient: DanarapayClient | null = null;

function getClient(): DanarapayClient {
  if (!danarapayClient) {
    const cfg = config.api.danarapay;
    if (!cfg?.baseUrl || !cfg?.username || !cfg?.apiKey) {
      throw new Error('DanaRpay configuration is incomplete. Required: DANARAPAY_BASE_URL, DANARAPAY_USERNAME, DANARAPAY_API_KEY');
    }
    danarapayClient = new DanarapayClient({
      baseUrl: cfg.baseUrl,
      username: cfg.username,
      apiKey: cfg.apiKey,
    });
  }
  return danarapayClient;
}

// ===================== HELPERS =====================

function getParsedBody(req: Request): any {
  const b: any = req.body;
  if (b && typeof b === 'object' && Object.keys(b).length > 0) return b;

  const raw = (req as any).rawBody;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      // ignore
    }
  }
  if (raw instanceof Buffer && raw.length) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      // ignore
    }
  }
  return b ?? {};
}

// ===================== STATUS MAPPING =====================

type InternalStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

/**
 * Map DanaRpay VA status to internal status
 * DanaRpay statuses: WAITING_PAYMENT, PAYMENT_DETECTED, EXPIRED, STATIC_TRX_EXPIRED, COMPLETE
 */
function mapVaStatusToInternal(vaStatus?: string, settlementStatus?: string): InternalStatus {
  const status = String(vaStatus ?? '').toUpperCase();
  
  // If settlement_status is SUCCESS, payment is complete
  if (settlementStatus === 'SUCCESS') {
    return 'SUCCESS';
  }
  
  switch (status) {
    case 'COMPLETE':
    case 'PAYMENT_DETECTED':
      return 'SUCCESS';
    case 'WAITING_PAYMENT':
      return 'PENDING';
    case 'EXPIRED':
    case 'STATIC_TRX_EXPIRED':
      return 'EXPIRED';
    default:
      return 'PENDING';
  }
}

// ===================== IDEMPOTENT UPDATE =====================

interface VaUpdateData {
  partnerTrxId?: string;
  partnerUserId?: string;
  vaNumber?: string;
  trxId?: string;
  amount?: number;
  txDate?: string;
  settlementStatus?: string;
  providerPayload?: any;
}

/**
 * Idempotent update VA transaction status
 * - Only updates if new status is a valid transition
 * - Prevents duplicate updates for same callback
 */
async function idempotentUpdateVaTransaction(data: VaUpdateData): Promise<{
  updated: boolean;
  reason?: string;
  order?: any;
}> {
  const { partnerTrxId, partnerUserId, vaNumber, trxId, amount, txDate, settlementStatus, providerPayload } = data;

  // Find order by partnerTrxId or partnerUserId
  const searchId = partnerTrxId || partnerUserId;
  if (!searchId) {
    logger.warn('[DanaRpay VA] No identifier in callback', { vaNumber });
    return { updated: false, reason: 'NO_IDENTIFIER' };
  }

  let order = await prisma.order.findFirst({
    where: {
      OR: [
        { id: searchId },
        { pgRefId: searchId },
        { pgClientRef: searchId },
        { userId: partnerUserId || '' },
      ],
    },
  });

  if (!order) {
    logger.warn('[DanaRpay VA] Order not found', { partnerTrxId, partnerUserId, vaNumber });
    return { updated: false, reason: 'ORDER_NOT_FOUND' };
  }

  const currentStatus = mapVaStatusToInternal(order.status);
  const newStatus = mapVaStatusToInternal('COMPLETE', settlementStatus);

  // Idempotency check: already in terminal state
  if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(currentStatus)) {
    if (currentStatus === newStatus) {
      logger.info('[DanaRpay VA] Duplicate callback, already processed', {
        orderId: order.id,
        status: currentStatus,
      });
      return { updated: false, reason: 'ALREADY_PROCESSED', order };
    }

    // Only allow SUCCESS to override PENDING
    if (currentStatus === 'SUCCESS' && newStatus !== 'SUCCESS') {
      logger.warn('[DanaRpay VA] Invalid status transition attempted', {
        orderId: order.id,
        currentStatus,
        newStatus,
      });
      return { updated: false, reason: 'INVALID_TRANSITION', order };
    }
  }

  // Build update payload
  const updateData: any = {
    status: newStatus,
    providerPayload: providerPayload ?? order.providerPayload,
    updatedAt: new Date(),
  };

  if (trxId && !order.pgRefId) {
    updateData.pgRefId = trxId;
  }

  if (newStatus === 'SUCCESS') {
    updateData.paymentReceivedTime = txDate ? new Date(txDate) : new Date();
    if (amount != null) {
      updateData.pendingAmount = 0;
    }
    // Set settlement time if provided
    if (settlementStatus === 'SUCCESS') {
      updateData.settlementTime = new Date();
      updateData.settlementStatus = 'SETTLED';
    } else if (settlementStatus === 'WAITING') {
      updateData.settlementStatus = 'WAITING';
    }
  }

  // Update order
  const updatedOrder = await prisma.order.update({
    where: { id: order.id },
    data: updateData,
  });

  logger.info('[DanaRpay VA] Order updated', {
    orderId: order.id,
    oldStatus: currentStatus,
    newStatus,
    settlementStatus,
  });

  return { updated: true, order: updatedOrder };
}

// ===================== CALLBACK HANDLER =====================

/**
 * DanaRpay VA Callback Handler
 * POST /api/v1/payments/danarapay/va/callback
 * 
 * Callback payload from DanaRpay:
 * - va_number, amount, partner_user_id, success, tx_date
 * - username_display, trx_expiration_date, partner_trx_id, trx_id
 * - settlement_time, settlement_status, full_name
 */
export async function danarapayVaCallback(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    // 1) Parse body
    const body: DanarapayVaCallbackPayload = getParsedBody(req);

    logger.info('[DanaRpay VA] Callback received', {
      va_number: body.va_number,
      partner_trx_id: body.partner_trx_id,
      partner_user_id: body.partner_user_id,
      amount: body.amount,
      success: body.success,
      settlement_status: body.settlement_status,
    });

    // 2) Validate required fields
    if (!body.va_number) {
      logger.warn('[DanaRpay VA] Missing va_number in callback');
      return res.status(400).json({ success: false, error: 'Missing va_number' });
    }

    // 3) ACK quickly (DanaRpay expects fast response)
    res.status(200).json({ success: true, message: 'Callback received' });

    // 4) Process in background
    setImmediate(async () => {
      try {
        // Store raw callback for audit
        await prisma.transaction_callback.create({
          data: {
            referenceId: null,
            requestBody: body as any,
            paymentReceivedTime: body.tx_date ? new Date(body.tx_date) : new Date(),
            settlementTime: body.settlement_time ? new Date(body.settlement_time) : null,
          },
        });

        // Idempotent status update
        const result = await idempotentUpdateVaTransaction({
          partnerTrxId: body.partner_trx_id,
          partnerUserId: body.partner_user_id,
          vaNumber: body.va_number,
          trxId: body.trx_id,
          amount: body.amount,
          txDate: body.tx_date,
          settlementStatus: body.settlement_status,
          providerPayload: body,
        });

        // Forward callback to partner client if order updated successfully
        if (result.updated && result.order?.partnerClientId) {
          try {
            // Get partner client info
            const partnerClient = await prisma.partnerClient.findUnique({
              where: { id: result.order.partnerClientId },
              select: { callbackUrl: true, callbackSecret: true }
            });

            if (partnerClient?.callbackUrl && partnerClient?.callbackSecret) {
              const timestamp = new Date().toISOString();
              const nonce = crypto.randomUUID();
              
              // Get bank name
              const bankNames: Record<string, string> = {
                '002': 'BRI', '008': 'Mandiri', '009': 'BNI', '013': 'Permata', '022': 'CIMB'
              };
              
              const callbackPayload = {
                orderId: result.order.id,
                status: result.order.status,
                channel: 'VA',
                vaNumber: body.va_number,
                bankCode: (result.order.providerPayload as any)?.bank_code || '',
                bankName: bankNames[(result.order.providerPayload as any)?.bank_code] || '',
                grossAmount: result.order.amount,
                feeLauncx: result.order.feeLauncx || 0,
                netAmount: result.order.settlementAmount || result.order.pendingAmount || 0,
                playerId: result.order.playerId || body.partner_user_id,
                settlementStatus: body.settlement_status || 'PENDING',
                timestamp,
                nonce,
              };

              const signature = crypto
                .createHmac('sha256', partnerClient.callbackSecret)
                .update(JSON.stringify(callbackPayload))
                .digest('hex');

              // Queue callback job
              await prisma.callbackJob.create({
                data: {
                  url: partnerClient.callbackUrl,
                  payload: callbackPayload,
                  signature,
                  partnerClientId: result.order.partnerClientId,
                },
              });

              logger.info('[DanaRpay VA] Queued partner callback', {
                orderId: result.order.id,
                partnerClientId: result.order.partnerClientId,
                callbackUrl: partnerClient.callbackUrl,
              });
            } else {
              logger.warn('[DanaRpay VA] Partner has no callback URL configured', {
                orderId: result.order.id,
                partnerClientId: result.order.partnerClientId,
              });
            }
          } catch (cbErr: any) {
            logger.error('[DanaRpay VA] Failed to queue partner callback', {
              orderId: result.order.id,
              error: cbErr?.message,
            });
          }
        }

        logger.info('[DanaRpay VA] Callback processed', {
          va_number: body.va_number,
          partner_trx_id: body.partner_trx_id,
          updated: result.updated,
          reason: result.reason,
          durationMs: Date.now() - startTime,
        });
      } catch (bgErr: any) {
        logger.error('[DanaRpay VA] Background processing error', {
          va_number: body.va_number,
          error: bgErr?.message ?? bgErr,
        });
      }
    });
  } catch (err: any) {
    logger.error('[DanaRpay VA] Callback handler error', {
      error: err?.message ?? err,
    });

    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Internal error' });
    }
  }
}

// ===================== CREATE VA ENDPOINT =====================

interface CreateVaRequestBody {
  /** Partner unique identifier for specific user (required) */
  partner_user_id: string;
  /** Bank code: 002 (BRI), 008 (Mandiri), 009 (BNI), 013 (Permata), 022 (CIMB) (required) */
  bank_code: string;
  /** Amount in IDR */
  amount?: number;
  /** true = open amount (default), false = closed amount */
  is_open?: boolean;
  /** true = close VA after payment (default: false) */
  is_single_use?: boolean;
  /** VA expiration time in minutes (default: 1440 = 24 hours) */
  expiration_time?: number;
  /** true = VA never expires */
  is_lifetime?: boolean;
  /** Display name shown to user, min 3 chars (required) */
  username_display: string;
  /** User email */
  email?: string;
  /** End-user full name */
  full_name?: string;
  /** Transaction expiration time in minutes */
  trx_expiration_time?: number;
  /** Partner unique transaction ID */
  partner_trx_id?: string;
  /** Transaction counter limit */
  trx_counter?: number;
}

/**
 * Create VA internal endpoint
 * POST /api/v1/payments/danarapay/va/create
 */
export async function createDanarapayVa(req: Request, res: Response) {
  try {
    const body: CreateVaRequestBody = req.body;

    // Validate required fields
    if (!body.partner_user_id) {
      return res.status(400).json({ success: false, error: 'partner_user_id is required' });
    }
    if (!body.bank_code) {
      return res.status(400).json({ success: false, error: 'bank_code is required' });
    }
    if (!body.username_display || body.username_display.length < 3) {
      return res.status(400).json({ success: false, error: 'username_display is required (min 3 chars)' });
    }

    // Validate bank code
    const validBankCodes = Object.values(VA_BANK_CODES);
    if (!validBankCodes.includes(body.bank_code as any)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid bank_code. Valid values: ${validBankCodes.join(', ')} (BRI, Mandiri, BNI, Permata, CIMB)` 
      });
    }

    const client = getClient();

    const request: CreateVaRequest = {
      partner_user_id: body.partner_user_id,
      bank_code: body.bank_code,
      amount: body.amount,
      is_open: body.is_open,
      is_single_use: body.is_single_use,
      expiration_time: body.expiration_time ?? 1440, // Default 24 hours
      is_lifetime: body.is_lifetime,
      username_display: body.username_display,
      email: body.email,
      full_name: body.full_name,
      trx_expiration_time: body.trx_expiration_time,
      partner_trx_id: body.partner_trx_id,
      trx_counter: body.trx_counter,
    };

    const result = await client.createVa(request);

    if (!result.success) {
      logger.warn('[DanaRpay VA] Create VA failed', {
        partner_user_id: body.partner_user_id,
        status: result.status,
      });
      return res.status(400).json({
        success: false,
        error: result.status?.message ?? 'Failed to create VA',
        code: result.status?.code,
      });
    }

    // Get partnerClientId from middleware (set by apiKeyAuth)
    const partnerClientId = (req as any).clientId;
    if (!partnerClientId) {
      logger.warn('[DanaRpay VA] No clientId in request context');
      return res.status(401).json({ success: false, error: 'Unauthorized - no client context' });
    }

    // Calculate expiration time
    const expirationMs = result.trx_expiration_time || result.expiration_time;
    const trxExpirationTime = expirationMs ? new Date(expirationMs) : null;

    // Create Order record in database with channel VA_DANARAPAY
    const orderId = result.id || body.partner_trx_id || `va-${Date.now()}`;
    
    try {
      await prisma.order.create({
        data: {
          id: orderId,
          partnerClient: { connect: { id: partnerClientId } },
          amount: body.amount || 0,
          pendingAmount: body.amount || 0,
          feeLauncx: 0,
          settlementAmount: 0,
          playerId: body.partner_user_id,
          userId: body.partner_user_id,
          status: 'PENDING',
          channel: 'VA_DANARAPAY',
          checkoutUrl: '',
          pgRefId: result.va_number,
          pgClientRef: body.partner_trx_id || null,
          trxExpirationTime: trxExpirationTime,
          providerPayload: {
            id: result.id,
            va_number: result.va_number,
            bank_code: result.bank_code,
            amount: result.amount,
            partner_user_id: result.partner_user_id,
            partner_trx_id: result.partner_trx_id,
            is_open: result.is_open,
            is_single_use: result.is_single_use,
            expiration_time: result.expiration_time,
            trx_expiration_time: result.trx_expiration_time,
            va_status: result.va_status || 'WAITING_PAYMENT',
            username_display: result.username_display,
          },
        },
      });

      logger.info('[DanaRpay VA] Order created', {
        orderId,
        partnerClientId,
        va_number: result.va_number,
        amount: body.amount,
      });
    } catch (dbErr: any) {
      // If duplicate key, ignore - VA already exists
      if (dbErr?.code === 'P2002') {
        logger.info('[DanaRpay VA] Order already exists, updating...', { orderId });
        await prisma.order.update({
          where: { id: orderId },
          data: {
            providerPayload: {
              id: result.id,
              va_number: result.va_number,
              bank_code: result.bank_code,
              amount: result.amount,
              partner_user_id: result.partner_user_id,
              partner_trx_id: result.partner_trx_id,
              is_open: result.is_open,
              is_single_use: result.is_single_use,
              expiration_time: result.expiration_time,
              trx_expiration_time: result.trx_expiration_time,
              va_status: result.va_status || 'WAITING_PAYMENT',
              username_display: result.username_display,
            },
          },
        });
      } else {
        logger.error('[DanaRpay VA] Failed to create order', { error: dbErr?.message });
        // Don't fail the request - VA was created successfully
      }
    }

    // Return success response
    return res.status(200).json({
      success: true,
      data: {
        id: orderId,
        va_number: result.va_number,
        bank_code: result.bank_code,
        amount: result.amount,
        partner_user_id: result.partner_user_id,
        partner_trx_id: result.partner_trx_id,
        is_open: result.is_open,
        is_single_use: result.is_single_use,
        expiration_time: result.expiration_time,
        trx_expiration_time: result.trx_expiration_time,
        va_status: result.va_status,
        username_display: result.username_display,
      },
    });
  } catch (err: any) {
    logger.error('[DanaRpay VA] Create VA error', {
      error: err?.message ?? err,
    });
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

// ===================== GET VA INFO ENDPOINT =====================

/**
 * Get VA Info by unique VA ID
 * GET /api/v1/payments/danarapay/va/info/:vaId
 */
export async function getDanarapayVaInfo(req: Request, res: Response) {
  try {
    const { vaId } = req.params;

    if (!vaId) {
      return res.status(400).json({ success: false, error: 'vaId is required' });
    }

    const client = getClient();
    const result = await client.getVaInfo(vaId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.status?.message ?? 'Failed to get VA info',
        code: result.status?.code,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: result.id,
        va_number: result.va_number,
        bank_code: result.bank_code,
        bank_name: result.bank_name,
        amount: result.amount,
        partner_user_id: result.partner_user_id,
        partner_trx_id: result.partner_trx_id,
        created: result.created,
        is_open: result.is_open,
        is_single_use: result.is_single_use,
        expiration_time: result.expiration_time,
        trx_expiration_time: result.trx_expiration_time,
        va_status: result.va_status,
        username_display: result.username_display,
        trx_counter: result.trx_counter,
        counter_incoming_payment: result.counter_incoming_payment,
      },
    });
  } catch (err: any) {
    logger.error('[DanaRpay VA] Get VA info error', {
      error: err?.message ?? err,
    });
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

// ===================== UPDATE VA ENDPOINT =====================

/**
 * Update VA by unique VA ID
 * PUT /api/v1/payments/danarapay/va/update/:vaId
 */
export async function updateDanarapayVa(req: Request, res: Response) {
  try {
    const { vaId } = req.params;
    const body: UpdateVaRequest = req.body;

    if (!vaId) {
      return res.status(400).json({ success: false, error: 'vaId is required' });
    }

    const client = getClient();
    const result = await client.updateVa(vaId, body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.status?.message ?? 'Failed to update VA',
        code: result.status?.code,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: result.id,
        va_number: result.va_number,
        bank_code: result.bank_code,
        amount: result.amount,
        partner_user_id: result.partner_user_id,
        partner_trx_id: result.partner_trx_id,
        is_open: result.is_open,
        is_single_use: result.is_single_use,
        expiration_time: result.expiration_time,
        trx_expiration_time: result.trx_expiration_time,
        va_status: result.va_status,
        username_display: result.username_display,
      },
    });
  } catch (err: any) {
    logger.error('[DanaRpay VA] Update VA error', {
      error: err?.message ?? err,
    });
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

// ===================== SIMULATE CALLBACK (STAGING ONLY) =====================

/**
 * Simulate VA payment callback (staging environment only)
 * POST /api/v1/payments/danarapay/va/simulate-callback
 */
export async function simulateDanarapayCallback(req: Request, res: Response) {
  try {
    const { id, amount } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'id (VA ID) is required' });
    }
    if (amount === undefined || amount === null) {
      return res.status(400).json({ success: false, error: 'amount is required' });
    }

    const client = getClient();
    const result = await client.simulateCallback(id, amount);

    return res.status(200).json({
      success: result.success,
      error: result.error,
    });
  } catch (err: any) {
    logger.error('[DanaRpay VA] Simulate callback error', {
      error: err?.message ?? err,
    });
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

// ===================== GET BANK CODES =====================

/**
 * Get available bank codes for VA
 * GET /api/v1/payments/danarapay/va/banks
 */
export async function getDanarapayVaBanks(_req: Request, res: Response) {
  return res.status(200).json({
    success: true,
    data: {
      banks: [
        { code: '002', name: 'BRI', features: ['open_amount', 'closed_amount', 'lifetime'] },
        { code: '008', name: 'Mandiri', features: ['open_amount', 'closed_amount', 'lifetime'] },
        { code: '009', name: 'BNI', features: ['closed_amount', 'lifetime'] },
        { code: '013', name: 'Permata', features: ['open_amount', 'closed_amount', 'lifetime'] },
        { code: '022', name: 'CIMB', features: ['open_amount', 'closed_amount', 'lifetime'] },
      ],
    },
  });
}

export default {
  danarapayVaCallback,
  createDanarapayVa,
  getDanarapayVaInfo,
  updateDanarapayVa,
  simulateDanarapayCallback,
  getDanarapayVaBanks,
};
