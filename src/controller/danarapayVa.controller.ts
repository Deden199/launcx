// File: src/controller/danarapayVa.controller.ts
// DanaRpay VA Aggregator Controller - Based on official API docs v1.2.4
// DanaRapay as Source of Truth - callbacks only update status, ledger handles balance

import { Request, Response } from 'express';
import crypto from 'crypto';
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
import { processOrderSettlement } from '../service/ledger.service';

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

/** Map bank code to bank name for client-facing response */
function getBankName(bankCode: string): string {
  const bankNames: Record<string, string> = {
    '002': 'BRI',
    '008': 'Mandiri',
    '009': 'BNI',
    '013': 'Permata',
    '022': 'CIMB Niaga',
  };
  return bankNames[bankCode] || bankCode;
}

/**
 * Determine response format based on route path or opt-in header
 * - New routes (/payments/va/*) → camelCase (default)
 * - Legacy routes (/payments/danarapay/va/*) → snake_case
 * - Header X-Compat-Mode: legacy → snake_case
 * - Query ?compat=1 → snake_case
 */
function getResponseFormat(req: Request): 'camelCase' | 'snakeCase' {
  // Check for opt-in legacy mode
  const compatHeader = req.header('X-Compat-Mode');
  const compatQuery = req.query.compat;
  
  if (compatHeader === 'legacy' || compatQuery === '1') {
    return 'snakeCase';
  }
  
  // Check route path - legacy routes use snake_case
  const path = req.path;
  if (path.includes('/danarapay/')) {
    return 'snakeCase';
  }
  
  // Default: new routes use camelCase
  return 'camelCase';
}

/**
 * Format VA creation response based on response format
 */
function formatVaCreateResponse(
  result: any,
  orderId: string,
  format: 'camelCase' | 'snakeCase'
) {
  if (format === 'camelCase') {
    // Clean camelCase response for client-facing endpoints
    return {
      id: orderId,
      vaNumber: result.va_number,
      bankCode: result.bank_code,
      bankName: getBankName(result.bank_code),
      amount: result.amount,
      customerId: result.partner_user_id,
      referenceId: result.partner_trx_id,
      isOpen: result.is_open,
      isSingleUse: result.is_single_use,
      expiresAt: result.expiration_time ? new Date(result.expiration_time).toISOString() : null,
      status: 'PENDING',
      displayName: result.username_display,
    };
  } else {
    // Legacy snake_case response for internal/backward compatibility
    return {
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
    };
  }
}

/**
 * Format VA info response based on response format
 */
function formatVaInfoResponse(
  result: any,
  format: 'camelCase' | 'snakeCase'
) {
  if (format === 'camelCase') {
    // Clean camelCase response
    return {
      id: result.id,
      vaNumber: result.va_number,
      bankCode: result.bank_code,
      bankName: getBankName(result.bank_code),
      amount: result.amount,
      customerId: result.partner_user_id,
      referenceId: result.partner_trx_id,
      createdAt: result.created,
      isOpen: result.is_open,
      isSingleUse: result.is_single_use,
      expiresAt: result.expiration_time ? new Date(result.expiration_time).toISOString() : null,
      status: result.va_status === 'WAITING_PAYMENT' ? 'PENDING' : result.va_status,
      displayName: result.username_display,
    };
  } else {
    // Legacy snake_case response
    return {
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
    };
  }
}

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

/**
 * DanaRapay Settlement Status (Source of Truth)
 * Langsung mapping dari DanaRapay API, tidak buat status internal baru
 */
const DANARAPAY_SETTLEMENT_STATUS = {
  WAITING: 'WAITING',     // Payment detected, belum settle ke account statement
  SUCCESS: 'SUCCESS',     // Settlement complete, dana sudah di account statement
} as const;

/**
 * Map DanaRapay settlement_status ke internal Order status
 * - WAITING → PAID (payment detected, menunggu settlement)
 * - SUCCESS → SETTLED (settlement complete)
 * 
 * Backward compatible: status lama tetap valid
 */
function mapSettlementStatusToOrderStatus(settlementStatus?: string | null): string {
  const status = String(settlementStatus ?? '').toUpperCase();
  
  switch (status) {
    case DANARAPAY_SETTLEMENT_STATUS.SUCCESS:
      return 'SETTLED';  // Final: settlement complete
    case DANARAPAY_SETTLEMENT_STATUS.WAITING:
      return 'PAID';     // Intermediate: payment detected, waiting settlement
    default:
      return 'PAID';     // Default to PAID jika tidak ada settlement_status
  }
}

/**
 * Map DanaRapay VA status ke internal status (untuk VA yang belum ada payment)
 */
function mapVaStatusToOrderStatus(vaStatus?: string): string {
  const status = String(vaStatus ?? '').toUpperCase();
  
  switch (status) {
    case 'COMPLETE':
    case 'PAYMENT_DETECTED':
      return 'PAID';      // Payment masuk, menunggu settlement
    case 'WAITING_PAYMENT':
      return 'PENDING';   // Belum ada payment
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
  settlementTime?: string;
  providerPayload?: any;
}

/**
 * Idempotent update VA transaction status
 * 
 * IMPORTANT: Callback HANYA mengubah status, TIDAK mengubah saldo.
 * Saldo diupdate oleh ledger logic terpisah yang membaca status SETTLED.
 * 
 * Flow berdasarkan DanaRapay settlement_status:
 * - settlement_status = WAITING → Order.status = PAID, Order.settlementStatus = WAITING
 * - settlement_status = SUCCESS → Order.status = SETTLED, Order.settlementStatus = SUCCESS
 */
async function idempotentUpdateVaTransaction(data: VaUpdateData): Promise<{
  updated: boolean;
  reason?: string;
  order?: any;
  isSettlementCallback?: boolean;
}> {
  const { partnerTrxId, partnerUserId, vaNumber, trxId, amount, txDate, settlementStatus, settlementTime, providerPayload } = data;

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

  const currentStatus = order.status;
  const currentSettlementStatus = order.settlementStatus;
  
  // Determine new status based on DanaRapay settlement_status
  const newOrderStatus = mapSettlementStatusToOrderStatus(settlementStatus);
  const isSettlementCallback = settlementStatus === DANARAPAY_SETTLEMENT_STATUS.SUCCESS;

  // Idempotency check: prevent invalid transitions
  if (currentStatus === 'SETTLED') {
    // Already settled - ignore duplicate callbacks
    logger.info('[DanaRpay VA] Order already SETTLED, ignoring callback', {
      orderId: order.id,
      currentStatus,
      incomingSettlementStatus: settlementStatus,
    });
    return { updated: false, reason: 'ALREADY_SETTLED', order };
  }

  // Prevent downgrade from PAID to something lower
  if (currentStatus === 'PAID' && newOrderStatus === 'PENDING') {
    logger.warn('[DanaRpay VA] Invalid status downgrade attempted', {
      orderId: order.id,
      currentStatus,
      newOrderStatus,
    });
    return { updated: false, reason: 'INVALID_DOWNGRADE', order };
  }

  // Build update payload - ONLY status fields, NO balance changes
  const updateData: any = {
    status: newOrderStatus,
    settlementStatus: settlementStatus || currentSettlementStatus,
    providerPayload: providerPayload ?? order.providerPayload,
    updatedAt: new Date(),
  };

  // Set pgRefId if provided and not already set
  if (trxId && !order.pgRefId) {
    updateData.pgRefId = trxId;
  }

  // Payment received time (for first callback - WAITING)
  if (txDate && !order.paymentReceivedTime) {
    updateData.paymentReceivedTime = new Date(txDate);
  }

  // Settlement time (for second callback - SUCCESS)
  if (isSettlementCallback) {
    updateData.settlementTime = settlementTime ? new Date(settlementTime) : new Date();
  }

  // Update order - HANYA STATUS, TIDAK ADA BALANCE UPDATE DI SINI
  const updatedOrder = await prisma.order.update({
    where: { id: order.id },
    data: updateData,
  });

  logger.info('[DanaRpay VA] Order status updated (callback only updates status)', {
    orderId: order.id,
    oldStatus: currentStatus,
    newStatus: newOrderStatus,
    settlementStatus,
    isSettlementCallback,
    // Note: Balance will be updated by ledger logic, not here
  });

  return { 
    updated: true, 
    order: updatedOrder, 
    isSettlementCallback 
  };
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

        // Idempotent status update - ONLY updates status, NOT balance
        const result = await idempotentUpdateVaTransaction({
          partnerTrxId: body.partner_trx_id,
          partnerUserId: body.partner_user_id,
          vaNumber: body.va_number,
          trxId: body.trx_id,
          amount: body.amount,
          txDate: body.tx_date,
          settlementStatus: body.settlement_status,
          settlementTime: body.settlement_time,
          providerPayload: body,
        });

        // If this was a settlement callback (SUCCESS), trigger ledger processing
        // Ledger service will handle balance credit independently
        if (result.updated && result.isSettlementCallback && result.order?.id) {
          try {
            const ledgerResult = await processOrderSettlement(result.order.id);
            logger.info('[DanaRpay VA] Ledger processing triggered', {
              orderId: result.order.id,
              ledgerProcessed: ledgerResult.processed,
              balanceChange: ledgerResult.balanceChange,
              reason: ledgerResult.reason,
            });
          } catch (ledgerErr: any) {
            // Log error but don't fail - ledger can be reconciled later
            logger.error('[DanaRpay VA] Ledger processing failed (will reconcile later)', {
              orderId: result.order.id,
              error: ledgerErr?.message,
            });
          }
        }

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
                settlementStatus: body.settlement_status || 'WAITING',
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

// ===================== DISBURSEMENT CALLBACK HANDLER =====================

import { 
  processWithdrawalCallback, 
  processWithdrawalBalanceDeduction,
  refundFailedWithdrawal,
  DISBURSEMENT_CODES,
  isDisbursementFinal,
} from '../service/ledger.service';

/**
 * DanaRapay Disbursement Callback Handler
 * POST /api/v1/payments/danarapay/disbursement/callback
 * 
 * Callback from DanaRapay after disbursement status changes.
 * This handler ONLY updates withdrawal status.
 * Balance deduction is handled by ledger service.
 * 
 * DanaRapay status codes (Source of Truth):
 * - 000: Success (Final) → COMPLETED, trigger balance deduction
 * - 101/102: In Progress → PROCESSING
 * - 301/504: Pending → PENDING
 * - 300/302/303/304/305: Failed (Final) → FAILED, trigger refund if needed
 * - 999/500: System Error → PENDING (need manual check)
 */
export async function danarapayDisbursementCallback(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const body = getParsedBody(req);

    logger.info('[DanaRpay Disbursement] Callback received', {
      partner_trx_id: body.partner_trx_id,
      trx_id: body.trx_id,
      status_code: body.status?.code,
      status_message: body.status?.message,
      amount: body.amount,
    });

    // Validate required fields
    const partnerTrxId = body.partner_trx_id;
    const statusCode = body.status?.code;

    if (!partnerTrxId) {
      logger.warn('[DanaRpay Disbursement] Missing partner_trx_id');
      return res.status(400).json({ success: false, error: 'Missing partner_trx_id' });
    }

    if (!statusCode) {
      logger.warn('[DanaRpay Disbursement] Missing status code');
      return res.status(400).json({ success: false, error: 'Missing status code' });
    }

    // ACK quickly
    res.status(200).json({ success: true, message: 'Callback received' });

    // Process in background
    setImmediate(async () => {
      try {
        // Update withdrawal status - ONLY status, NO balance change
        const result = await processWithdrawalCallback(partnerTrxId, statusCode, body);

        if (result.processed) {
          // Only trigger ledger for FINAL states
          // Non-final states (PROCESSING, PENDING) don't affect balance
          
          if (result.isFinal) {
            if (result.newStatus === 'COMPLETED') {
              // SUCCESS - trigger ledger to deduct balance (atomic, idempotent)
              try {
                const ledgerResult = await processWithdrawalBalanceDeduction(partnerTrxId);
                logger.info('[DanaRpay Disbursement] Ledger balance deduction triggered', {
                  withdrawalId: partnerTrxId,
                  processed: ledgerResult.processed,
                  balanceChange: ledgerResult.balanceChange,
                  reason: ledgerResult.reason,
                });
              } catch (ledgerErr: any) {
                logger.error('[DanaRpay Disbursement] Ledger processing failed', {
                  withdrawalId: partnerTrxId,
                  error: ledgerErr?.message,
                });
              }
            } else if (result.newStatus === 'FAILED') {
              // FAILED - refund any pre-deducted balance (backward compatibility for legacy providers)
              try {
                const refundResult = await refundFailedWithdrawal(partnerTrxId);
                logger.info('[DanaRpay Disbursement] Refund triggered', {
                  withdrawalId: partnerTrxId,
                  processed: refundResult.processed,
                  reason: refundResult.reason,
                });
              } catch (refundErr: any) {
                logger.error('[DanaRpay Disbursement] Refund failed', {
                  withdrawalId: partnerTrxId,
                  error: refundErr?.message,
                });
              }
            }
          } else {
            // Non-final status - just log, no balance action
            logger.info('[DanaRpay Disbursement] Non-final status, no balance action', {
              withdrawalId: partnerTrxId,
              newStatus: result.newStatus,
              statusCode,
            });
          }
        }

        logger.info('[DanaRpay Disbursement] Callback processed', {
          partner_trx_id: partnerTrxId,
          statusCode,
          newStatus: result.newStatus,
          isFinal: result.isFinal,
          processed: result.processed,
          reason: result.reason,
          durationMs: Date.now() - startTime,
        });
      } catch (bgErr: any) {
        logger.error('[DanaRpay Disbursement] Background processing error', {
          partner_trx_id: partnerTrxId,
          error: bgErr?.message ?? bgErr,
        });
      }
    });
  } catch (err: any) {
    logger.error('[DanaRpay Disbursement] Callback handler error', {
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
  partner_user_id?: string;
  /** Bank code: 002 (BRI), 008 (Mandiri), 009 (BNI), 013 (Permata), 022 (CIMB) (required) */
  bank_code?: string;
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
  username_display?: string;
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
  
  // ─── CAMELCASE ALIASES (Client-Facing) ───
  /** Alias for partner_user_id */
  customerId?: string;
  /** Alias for bank_code */
  bankCode?: string;
  /** Alias for is_open */
  isOpen?: boolean;
  /** Alias for is_single_use */
  isSingleUse?: boolean;
  /** Alias for expiration_time */
  expirationMinutes?: number;
  /** Alias for is_lifetime */
  isLifetime?: boolean;
  /** Alias for username_display */
  displayName?: string;
  /** Alias for full_name */
  fullName?: string;
  /** Alias for trx_expiration_time */
  trxExpirationMinutes?: number;
  /** Alias for partner_trx_id */
  referenceId?: string;
  /** Alias for trx_counter */
  trxCounter?: number;
}

/**
 * Create VA internal endpoint
 * POST /api/v1/payments/danarapay/va/create (legacy)
 * POST /api/v1/payments/va (client-facing, provider-agnostic)
 */
export async function createDanarapayVa(req: Request, res: Response) {
  try {
    const body: CreateVaRequestBody = req.body;

    // Normalize: accept both camelCase (client-facing) and snake_case (legacy)
    const partnerUserId = body.partner_user_id || body.customerId;
    const bankCode = body.bank_code || body.bankCode;
    const usernameDisplay = body.username_display || body.displayName;
    const isOpen = body.is_open ?? body.isOpen;
    const isSingleUse = body.is_single_use ?? body.isSingleUse;
    const expirationTime = body.expiration_time ?? body.expirationMinutes;
    const isLifetime = body.is_lifetime ?? body.isLifetime;
    const fullName = body.full_name || body.fullName;
    const trxExpirationTimeBody = body.trx_expiration_time ?? body.trxExpirationMinutes;
    const partnerTrxId = body.partner_trx_id || body.referenceId;
    const trxCounter = body.trx_counter ?? body.trxCounter;

    // Validate required fields
    if (!partnerUserId) {
      return res.status(400).json({ success: false, error: 'customerId (or partner_user_id) is required' });
    }
    if (!bankCode) {
      return res.status(400).json({ success: false, error: 'bankCode (or bank_code) is required' });
    }
    if (!usernameDisplay || usernameDisplay.length < 3) {
      return res.status(400).json({ success: false, error: 'displayName (or username_display) is required (min 3 chars)' });
    }

    // Validate bank code
    const validBankCodes = Object.values(VA_BANK_CODES);
    if (!validBankCodes.includes(bankCode as any)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid bankCode. Valid values: ${validBankCodes.join(', ')} (BRI, Mandiri, BNI, Permata, CIMB)` 
      });
    }

    const client = getClient();

    const request: CreateVaRequest = {
      partner_user_id: partnerUserId,
      bank_code: bankCode,
      amount: body.amount,
      is_open: isOpen,
      is_single_use: isSingleUse,
      expiration_time: expirationTime ?? 1440, // Default 24 hours
      is_lifetime: isLifetime,
      username_display: usernameDisplay,
      email: body.email,
      full_name: fullName,
      trx_expiration_time: trxExpirationTimeBody,
      partner_trx_id: partnerTrxId,
      trx_counter: trxCounter,
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
    const orderExpiration = expirationMs ? new Date(expirationMs) : null;

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
          playerId: partnerUserId,
          userId: partnerUserId,
          status: 'PENDING',
          channel: 'VA_DANARAPAY',
          checkoutUrl: '',
          pgRefId: result.va_number,
          pgClientRef: partnerTrxId || null,
          trxExpirationTime: orderExpiration,
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

    // Return success response (include both snake_case and camelCase for compatibility)
    return res.status(200).json({
      success: true,
      data: {
        // Primary fields (camelCase - client-facing)
        id: orderId,
        vaNumber: result.va_number,
        bankCode: result.bank_code,
        bankName: getBankName(result.bank_code),
        amount: result.amount,
        customerId: result.partner_user_id,
        referenceId: result.partner_trx_id,
        isOpen: result.is_open,
        isSingleUse: result.is_single_use,
        expiresAt: result.expiration_time ? new Date(result.expiration_time).toISOString() : null,
        status: 'PENDING',
        displayName: result.username_display,
        // Legacy fields (snake_case - backward compatibility)
        va_number: result.va_number,
        bank_code: result.bank_code,
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
        // Primary fields (camelCase - client-facing)
        id: result.id,
        vaNumber: result.va_number,
        bankCode: result.bank_code,
        bankName: getBankName(result.bank_code),
        amount: result.amount,
        customerId: result.partner_user_id,
        referenceId: result.partner_trx_id,
        createdAt: result.created,
        isOpen: result.is_open,
        isSingleUse: result.is_single_use,
        expiresAt: result.expiration_time ? new Date(result.expiration_time).toISOString() : null,
        status: result.va_status === 'WAITING_PAYMENT' ? 'PENDING' : result.va_status,
        displayName: result.username_display,
        // Legacy fields (snake_case - backward compatibility)
        va_number: result.va_number,
        bank_code: result.bank_code,
        bank_name: result.bank_name,
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
