// File: src/controller/danarapayVa.controller.ts
// DanaRpay VA Aggregator Controller

import { Request, Response } from 'express';
import logger from '../logger';
import prisma from '../core/prisma';
import { config } from '../config';
import {
  DanarapayClient,
  DanarapayVaCallbackPayload,
  CreateVaRequest,
} from '../service/danarapayClient';

// ===================== CLIENT INSTANCE =====================

let danarapayClient: DanarapayClient | null = null;

function getClient(): DanarapayClient {
  if (!danarapayClient) {
    const cfg = config.api.danarapay;
    if (!cfg?.baseUrl || !cfg?.merchantId || !cfg?.apiKey || !cfg?.secretKey) {
      throw new Error('DanaRpay configuration is incomplete');
    }
    danarapayClient = new DanarapayClient({
      baseUrl: cfg.baseUrl,
      merchantId: cfg.merchantId,
      apiKey: cfg.apiKey,
      secretKey: cfg.secretKey,
      callbackUrl: cfg.callbackUrl,
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

function getRawBody(req: Request): string {
  const raw = (req as any).rawBody;
  if (typeof raw === 'string') return raw;
  if (raw instanceof Buffer) return raw.toString('utf8');
  if (req.body && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }
  return '';
}

// ===================== STATUS MAPPING =====================

type InternalStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

function mapVaStatusToInternal(providerStatus?: string): InternalStatus {
  const status = String(providerStatus ?? '').toUpperCase();
  switch (status) {
    case 'PAID':
    case 'SUCCESS':
    case 'COMPLETED':
    case 'SETTLEMENT':
      return 'SUCCESS';
    case 'PENDING':
    case 'WAITING':
    case 'ACTIVE':
      return 'PENDING';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'CANCELLED':
    case 'CANCELED':
      return 'CANCELLED';
    case 'FAILED':
    case 'ERROR':
    case 'REJECTED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

// ===================== IDEMPOTENT UPDATE =====================

interface VaUpdateData {
  partnerTrxId: string;
  trxId?: string;
  status: string;
  paidAmount?: number;
  paidAt?: Date | null;
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
  const { partnerTrxId, trxId, status, paidAmount, paidAt, providerPayload } = data;
  const internalStatus = mapVaStatusToInternal(status);

  // Find order by partnerTrxId (which is Order.id or custom reference)
  let order = await prisma.order.findFirst({
    where: {
      OR: [
        { id: partnerTrxId },
        { pgRefId: partnerTrxId },
        { pgClientRef: partnerTrxId },
      ],
    },
  });

  if (!order) {
    logger.warn('[DanaRpay VA] Order not found', { partnerTrxId, trxId });
    return { updated: false, reason: 'ORDER_NOT_FOUND' };
  }

  const currentStatus = mapVaStatusToInternal(order.status);

  // Idempotency check: already in terminal state
  if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(currentStatus)) {
    if (currentStatus === internalStatus) {
      logger.info('[DanaRpay VA] Duplicate callback, already processed', {
        partnerTrxId,
        status: currentStatus,
      });
      return { updated: false, reason: 'ALREADY_PROCESSED', order };
    }

    // Prevent backward transition (e.g., SUCCESS -> PENDING)
    logger.warn('[DanaRpay VA] Invalid status transition attempted', {
      partnerTrxId,
      currentStatus,
      newStatus: internalStatus,
    });
    return { updated: false, reason: 'INVALID_TRANSITION', order };
  }

  // Build update payload
  const updateData: any = {
    status: internalStatus,
    providerPayload: providerPayload ?? order.providerPayload,
    updatedAt: new Date(),
  };

  if (trxId && !order.pgRefId) {
    updateData.pgRefId = trxId;
  }

  if (internalStatus === 'SUCCESS') {
    updateData.paymentReceivedTime = paidAt ?? new Date();
    if (paidAmount != null) {
      updateData.pendingAmount = 0;
    }
  }

  // Update order
  const updatedOrder = await prisma.order.update({
    where: { id: order.id },
    data: updateData,
  });

  logger.info('[DanaRpay VA] Order updated', {
    orderId: order.id,
    partnerTrxId,
    oldStatus: currentStatus,
    newStatus: internalStatus,
  });

  return { updated: true, order: updatedOrder };
}

// ===================== CALLBACK HANDLER =====================

/**
 * DanaRpay VA Callback Handler
 * POST /api/v1/payments/danarapay/va/callback
 */
export async function danarapayVaCallback(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    // 1) Parse body
    const body: DanarapayVaCallbackPayload = getParsedBody(req);
    const rawBody = getRawBody(req);

    logger.info('[DanaRpay VA] Callback received', {
      trxId: body.trx_id,
      partnerTrxId: body.partner_trx_id,
      status: body.status,
      amount: body.amount,
    });

    // 2) Verify signature (if provided)
    const signature = String(
      req.header('X-Signature') ??
        req.header('x-signature') ??
        body.signature ??
        ''
    );

    if (signature && config.api.danarapay?.verifyCallback !== false) {
      const client = getClient();
      const isValid =
        client.verifyCallbackSignature(rawBody, signature) ||
        client.verifyCallbackSignatureAlt(body, signature);

      if (!isValid) {
        logger.warn('[DanaRpay VA] Invalid callback signature', {
          trxId: body.trx_id,
          partnerTrxId: body.partner_trx_id,
        });
        return res.status(401).json({ success: false, error: 'Invalid signature' });
      }
    }

    // 3) Validate required fields
    const partnerTrxId = body.partner_trx_id;
    if (!partnerTrxId) {
      logger.warn('[DanaRpay VA] Missing partner_trx_id in callback');
      return res.status(400).json({ success: false, error: 'Missing partner_trx_id' });
    }

    // 4) ACK quickly (DanaRpay expects fast response)
    res.status(200).json({ success: true, message: 'Callback received' });

    // 5) Process in background
    setImmediate(async () => {
      try {
        // Store raw callback for audit
        await prisma.transaction_callback.create({
          data: {
            referenceId: null, // Will be linked via partnerTrxId
            requestBody: body as any,
            paymentReceivedTime: body.paid_at ? new Date(body.paid_at) : null,
          },
        });

        // Idempotent status update
        const result = await idempotentUpdateVaTransaction({
          partnerTrxId,
          trxId: body.trx_id,
          status: body.status ?? 'UNKNOWN',
          paidAmount: body.paid_amount ?? body.amount,
          paidAt: body.paid_at ? new Date(body.paid_at) : null,
          providerPayload: body,
        });

        // TODO: Trigger partner callback if order updated successfully
        if (result.updated && result.order?.partnerClientId) {
          // Queue callback to partner
          logger.info('[DanaRpay VA] Queuing partner callback', {
            orderId: result.order.id,
            partnerClientId: result.order.partnerClientId,
          });
        }

        logger.info('[DanaRpay VA] Callback processed', {
          partnerTrxId,
          updated: result.updated,
          reason: result.reason,
          durationMs: Date.now() - startTime,
        });
      } catch (bgErr: any) {
        logger.error('[DanaRpay VA] Background processing error', {
          partnerTrxId,
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
  partnerTrxId?: string;
  orderId?: string;
  bankCode: string;
  amount?: number;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  expirationMinutes?: number;
  description?: string;
  metadata?: Record<string, any>;
}

/**
 * Create VA internal endpoint
 * POST /api/v1/payments/danarapay/va/create
 */
export async function createDanarapayVa(req: Request, res: Response) {
  try {
    const body: CreateVaRequestBody = req.body;

    // Validate required fields
    if (!body.bankCode) {
      return res.status(400).json({ success: false, error: 'bankCode is required' });
    }
    if (!body.customerName) {
      return res.status(400).json({ success: false, error: 'customerName is required' });
    }

    // Generate unique reference if not provided
    const partnerTrxId = body.partnerTrxId ?? body.orderId ?? `VA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const client = getClient();

    const request: CreateVaRequest = {
      partnerTrxId,
      bankCode: body.bankCode.toUpperCase(),
      amount: body.amount,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      customerPhone: body.customerPhone,
      expirationMinutes: body.expirationMinutes ?? 1440, // Default 24 hours
      description: body.description,
      metadata: body.metadata,
    };

    const result = await client.createVa(request);

    if (!result.success) {
      logger.warn('[DanaRpay VA] Create VA failed', {
        partnerTrxId,
        message: result.message,
        code: result.responseCode,
      });
      return res.status(400).json({
        success: false,
        error: result.message ?? 'Failed to create VA',
        code: result.responseCode,
      });
    }

    // Return success response
    return res.status(200).json({
      success: true,
      data: {
        partnerTrxId: result.partnerTrxId,
        trxId: result.trxId,
        vaNumber: result.vaNumber,
        bankCode: result.bankCode,
        bankName: result.bankName,
        amount: result.amount,
        customerName: result.customerName,
        expiredAt: result.expiredAt,
        status: result.status,
      },
    });
  } catch (err: any) {
    logger.error('[DanaRpay VA] Create VA error', {
      error: err?.message ?? err,
    });
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

// ===================== STATUS INQUIRY ENDPOINT =====================

/**
 * Get VA Status
 * GET /api/v1/payments/danarapay/va/status/:partnerTrxId
 */
export async function getDanarapayVaStatus(req: Request, res: Response) {
  try {
    const { partnerTrxId } = req.params;

    if (!partnerTrxId) {
      return res.status(400).json({ success: false, error: 'partnerTrxId is required' });
    }

    const client = getClient();
    const result = await client.getVaStatus(partnerTrxId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.message ?? 'Failed to get VA status',
        code: result.responseCode,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        partnerTrxId: result.partnerTrxId,
        trxId: result.trxId,
        vaNumber: result.vaNumber,
        bankCode: result.bankCode,
        amount: result.amount,
        paidAmount: result.paidAmount,
        status: result.status,
        paidAt: result.paidAt,
        expiredAt: result.expiredAt,
      },
    });
  } catch (err: any) {
    logger.error('[DanaRpay VA] Get status error', {
      error: err?.message ?? err,
    });
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

// ===================== GET BANK CHANNELS =====================

/**
 * Get available bank channels
 * GET /api/v1/payments/danarapay/va/banks
 */
export async function getDanarapayVaBanks(req: Request, res: Response) {
  try {
    const client = getClient();
    const result = await client.getBankChannels();

    return res.status(200).json({
      success: result.success,
      data: {
        banks: result.banks,
      },
    });
  } catch (err: any) {
    logger.error('[DanaRpay VA] Get banks error', {
      error: err?.message ?? err,
    });
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

export default {
  danarapayVaCallback,
  createDanarapayVa,
  getDanarapayVaStatus,
  getDanarapayVaBanks,
};
