// src/controller/internalWebhook.controller.ts
// Handler for internal webhook from danarapay-router

import { Request, Response } from 'express';
import { prisma } from '../core/prisma';
import logger from '../logger';

// Internal secret for authentication
const INTERNAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET || 'internal_shared_secret_123';

/**
 * Unified webhook payload from danarapay-router
 */
interface InternalWebhookPayload {
  eventType: 'VA' | 'QRIS' | 'DISBURSEMENT';
  provider: 'DANARAPAY';
  partnerTrxId: string;
  providerTrxId: string;
  amount: number;
  status: string;
  providerStatus: string;
  paidAt?: string;
  settledAt?: string;
  settlementStatus?: string;
  metadata: any;
  rawPayload: any;
  processedAt: string;
}

/**
 * Map router status to Order status
 */
function mapToOrderStatus(status: string): string {
  const map: Record<string, string> = {
    PENDING: 'PENDING',
    WAITING_PAYMENT: 'PENDING',
    PAYMENT_DETECTED: 'PAID',
    SUCCESS: 'SUCCESS',
    COMPLETE: 'SUCCESS',
    FAILED: 'FAILED',
    EXPIRED: 'EXPIRED',
    CANCELLED: 'FAILED',
  };
  return map[status] || 'PENDING';
}

/**
 * POST /api/v1/internal/webhook
 * Receive events from danarapay-router
 */
export async function handleInternalWebhook(req: Request, res: Response) {
  // Verify internal secret
  const secret = req.header('X-Internal-Secret');
  if (secret !== INTERNAL_SECRET) {
    logger.warn('[InternalWebhook] Invalid secret');
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const payload = req.body as InternalWebhookPayload;
  const eventType = req.header('X-Event-Type') || payload.eventType;

  const log = logger.child({
    eventType,
    provider: payload.provider,
    partnerTrxId: payload.partnerTrxId,
    status: payload.status,
  });

  log.info('[InternalWebhook] Received event');

  try {
    // Find existing order by partner_trx_id or create new
    let order = await prisma.order.findFirst({
      where: {
        OR: [
          { id: payload.partnerTrxId },
          { pgClientRef: payload.partnerTrxId },
          { pgRefId: payload.providerTrxId },
        ],
      },
    });

    if (!order) {
      log.warn('[InternalWebhook] Order not found, may need to create');
      // For DISBURSEMENT events, this might be a withdrawal
      // For VA/QRIS, order should exist from create call
      return res.json({
        success: true,
        message: 'Event received, order not found',
        action: 'skip',
      });
    }

    const orderStatus = mapToOrderStatus(payload.status);

    // Update order based on event type
    const updateData: any = {
      status: orderStatus,
      providerPayload: {
        ...(order.providerPayload as any || {}),
        lastEvent: payload.rawPayload,
        lastEventAt: payload.processedAt,
      },
    };

    // Set payment time if paid
    if (['SUCCESS', 'PAID', 'COMPLETE', 'PAYMENT_DETECTED'].includes(payload.status)) {
      if (payload.paidAt) {
        updateData.paymentReceivedTime = new Date(payload.paidAt);
      }
      if (payload.settledAt) {
        updateData.settlementTime = new Date(payload.settledAt);
      }
    }

    // Update settlement status
    if (payload.settlementStatus) {
      updateData.settlementStatus = payload.settlementStatus;
    }

    // Update order
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: updateData,
    });

    log.info(
      { orderId: updatedOrder.id, newStatus: orderStatus },
      '[InternalWebhook] Order updated'
    );

    // Forward callback to partner client if applicable
    if (['SUCCESS', 'PAID', 'FAILED', 'EXPIRED'].includes(orderStatus)) {
      await forwardToPartnerCallback(updatedOrder, payload, log);
    }

    return res.json({
      success: true,
      message: 'Event processed',
      orderId: updatedOrder.id,
      status: orderStatus,
    });
  } catch (err: any) {
    log.error({ error: err.message }, '[InternalWebhook] Failed to process event');
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * Forward callback to partner client
 */
async function forwardToPartnerCallback(
  order: any,
  payload: InternalWebhookPayload,
  log: any
) {
  try {
    // Get partner client callback URL
    const partnerClient = await prisma.partnerClient.findUnique({
      where: { id: order.partnerClientId },
      select: { callbackUrl: true, callbackSecret: true },
    });

    if (!partnerClient?.callbackUrl || !partnerClient?.callbackSecret) {
      log.info('[InternalWebhook] Partner has no callback configured');
      return;
    }

    const crypto = await import('crypto');
    const axios = (await import('axios')).default;

    const callbackPayload = {
      orderId: order.id,
      status: order.status,
      channel: payload.eventType,
      amount: payload.amount,
      paidAt: payload.paidAt,
      settledAt: payload.settledAt,
      settlementStatus: payload.settlementStatus,
      playerId: order.playerId,
      metadata: payload.metadata,
      timestamp: new Date().toISOString(),
      nonce: crypto.randomUUID(),
    };

    const signature = crypto
      .createHmac('sha256', partnerClient.callbackSecret)
      .update(JSON.stringify(callbackPayload))
      .digest('hex');

    // Queue callback (or send directly)
    await prisma.callbackJob.create({
      data: {
        url: partnerClient.callbackUrl,
        payload: callbackPayload,
        signature,
        partnerClientId: order.partnerClientId,
      },
    });

    log.info('[InternalWebhook] Callback queued for partner');
  } catch (err: any) {
    log.error({ error: err.message }, '[InternalWebhook] Failed to queue partner callback');
  }
}
