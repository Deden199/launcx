// src/services/forwarder.service.ts
import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { withRetry, isRetryableError } from '../utils/retry';
import {
  InternalWebhookPayload,
  EventType,
  EventStatus,
  VaMetadata,
  QrisMetadata,
  DisbursementMetadata,
  BANK_NAMES,
  normalizeVaStatus,
  normalizeQrisStatus,
  normalizeDisbursementStatus,
} from '../types/internal.types';
import {
  VaCallbackPayload,
  QrisCallbackPayload,
  DisbursementStatusResponse,
  CreateVaResponse,
  CreateQrisResponse,
  CreateDisbursementResponse,
} from '../types/danarapay.types';

/**
 * Forward unified event to launcx-core internal webhook
 */
export async function forwardToLauncxCore(
  payload: InternalWebhookPayload
): Promise<void> {
  const log = logger.child({
    eventType: payload.eventType,
    partnerTrxId: payload.partnerTrxId,
    status: payload.status,
  });

  return withRetry(
    async () => {
      log.info('Forwarding event to launcx-core');

      const response = await axios.post(
        config.launcxCore.webhookUrl,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Secret': config.launcxCore.internalSecret,
            'X-Event-Type': payload.eventType,
          },
          timeout: 10000,
        }
      );

      log.info(
        { responseStatus: response.status },
        'Event forwarded successfully'
      );
    },
    'forwardToLauncxCore',
    {
      maxAttempts: 5,
      shouldRetry: isRetryableError,
    }
  );
}

// ==================== VA EVENT BUILDERS ====================

/**
 * Build VA event payload from callback
 */
export function buildVaCallbackEvent(
  callback: VaCallbackPayload
): InternalWebhookPayload {
  const metadata: VaMetadata = {
    vaNumber: callback.va_number,
    bankCode: callback.bank_code,
    bankName: BANK_NAMES[callback.bank_code] || callback.bank_code,
    partnerUserId: callback.partner_user_id,
    isOpen: callback.is_open,
    isSingleUse: callback.is_single_use,
  };

  return {
    eventType: 'VA',
    provider: 'DANARAPAY',
    partnerTrxId: callback.partner_trx_id,
    providerTrxId: callback.id,
    amount: callback.amount,
    status: normalizeVaStatus(callback.va_status),
    providerStatus: callback.va_status,
    paidAt: callback.va_status === 'COMPLETE' ? callback.tx_date : undefined,
    settlementStatus: callback.settlement_status,
    metadata,
    rawPayload: callback,
    processedAt: new Date().toISOString(),
  };
}

/**
 * Build VA event payload from create response
 */
export function buildVaCreatedEvent(
  response: CreateVaResponse,
  partnerTrxId: string
): InternalWebhookPayload {
  const metadata: VaMetadata = {
    vaNumber: response.va_number,
    bankCode: response.bank_code,
    bankName: BANK_NAMES[response.bank_code] || response.bank_code,
    partnerUserId: response.partner_user_id,
    usernameDisplay: response.username_display,
    isOpen: response.is_open,
    isSingleUse: response.is_single_use,
  };

  return {
    eventType: 'VA',
    provider: 'DANARAPAY',
    partnerTrxId: partnerTrxId || response.partner_trx_id,
    providerTrxId: response.id,
    amount: response.amount,
    status: 'WAITING_PAYMENT',
    providerStatus: response.va_status,
    metadata,
    rawPayload: response,
    processedAt: new Date().toISOString(),
  };
}

// ==================== QRIS EVENT BUILDERS ====================

/**
 * Build QRIS event payload from callback
 */
export function buildQrisCallbackEvent(
  callback: QrisCallbackPayload
): InternalWebhookPayload {
  const metadata: QrisMetadata = {
    qrisUrl: callback.payment_info?.qris_url,
    paymentReferenceNumber: callback.payment_info?.payment_reference_number,
    paymentMethod: callback.payment_method || 'QRIS',
    senderBank: callback.sender_bank,
    needFrontend: callback.need_frontend,
  };

  return {
    eventType: 'QRIS',
    provider: 'DANARAPAY',
    partnerTrxId: callback.partner_trx_id,
    providerTrxId: callback.trx_id,
    amount: callback.receive_amount,
    status: normalizeQrisStatus(callback.payment_status),
    providerStatus: callback.payment_status,
    paidAt: callback.payment_received_time,
    settledAt: callback.settlement_time,
    settlementStatus: callback.settlement_status,
    metadata,
    rawPayload: callback,
    processedAt: new Date().toISOString(),
  };
}

/**
 * Build QRIS event payload from create response
 */
export function buildQrisCreatedEvent(
  response: CreateQrisResponse,
  partnerTrxId: string
): InternalWebhookPayload {
  const metadata: QrisMetadata = {
    qrisUrl: response.payment_info?.qris_url,
    paymentMethod: response.payment_method || 'QRIS',
    needFrontend: !!response.payment_info?.payment_checkout_url,
  };

  return {
    eventType: 'QRIS',
    provider: 'DANARAPAY',
    partnerTrxId: partnerTrxId || response.partner_trx_id,
    providerTrxId: response.trx_id,
    amount: response.receive_amount,
    status: 'PENDING',
    providerStatus: 'CREATED',
    metadata,
    rawPayload: response,
    processedAt: new Date().toISOString(),
  };
}

// ==================== DISBURSEMENT EVENT BUILDERS ====================

/**
 * Build disbursement event payload from status response
 */
export function buildDisbursementEvent(
  response: DisbursementStatusResponse
): InternalWebhookPayload {
  const metadata: DisbursementMetadata = {
    remitId: response.remit_id,
    recipientBank: response.recipient_bank,
    recipientBankName: response.recipient_bank_name,
    recipientAccount: response.recipient_account,
    recipientName: response.recipient_name,
    adminFee: response.admin_fee,
    notes: response.notes,
  };

  return {
    eventType: 'DISBURSEMENT',
    provider: 'DANARAPAY',
    partnerTrxId: response.partner_trx_id,
    providerTrxId: response.remit_id,
    amount: response.amount,
    status: normalizeDisbursementStatus(response.remit_status),
    providerStatus: response.remit_status,
    settledAt: response.completed_at,
    metadata,
    rawPayload: response,
    processedAt: new Date().toISOString(),
  };
}

/**
 * Build disbursement event from create response
 */
export function buildDisbursementCreatedEvent(
  response: CreateDisbursementResponse,
  partnerTrxId: string
): InternalWebhookPayload {
  const metadata: DisbursementMetadata = {
    remitId: response.remit_id,
    recipientBank: response.recipient_bank,
    recipientBankName: response.recipient_bank_name,
    recipientAccount: response.recipient_account,
    recipientName: response.recipient_name,
    adminFee: response.admin_fee,
    notes: response.notes,
  };

  return {
    eventType: 'DISBURSEMENT',
    provider: 'DANARAPAY',
    partnerTrxId: partnerTrxId || response.partner_trx_id,
    providerTrxId: response.remit_id,
    amount: response.amount,
    status: 'PENDING',
    providerStatus: response.remit_status,
    metadata,
    rawPayload: response,
    processedAt: new Date().toISOString(),
  };
}
