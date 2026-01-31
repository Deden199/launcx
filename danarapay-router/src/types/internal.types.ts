// src/types/internal.types.ts

/**
 * Unified event types for forwarding to launcx-core
 */
export type EventType = 'VA' | 'QRIS' | 'DISBURSEMENT';

export type EventStatus =
  | 'PENDING'
  | 'WAITING_PAYMENT'
  | 'PAYMENT_DETECTED'
  | 'COMPLETE'
  | 'SUCCESS'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

/**
 * Unified webhook payload to launcx-core
 */
export interface InternalWebhookPayload {
  /** Event type: VA, QRIS, or DISBURSEMENT */
  eventType: EventType;

  /** Provider identifier */
  provider: 'DANARAPAY';

  /** Partner transaction ID - primary key for mapping */
  partnerTrxId: string;

  /** Provider's internal transaction ID */
  providerTrxId: string;

  /** Transaction amount */
  amount: number;

  /** Normalized status */
  status: EventStatus;

  /** Original provider status (raw) */
  providerStatus: string;

  /** Payment received timestamp (ISO) */
  paidAt?: string;

  /** Settlement timestamp (ISO) */
  settledAt?: string;

  /** Settlement status from provider */
  settlementStatus?: string;

  /** Additional metadata based on event type */
  metadata: VaMetadata | QrisMetadata | DisbursementMetadata;

  /** Raw payload for audit/debug */
  rawPayload: unknown;

  /** Timestamp when this event was processed (ISO) */
  processedAt: string;
}

export interface VaMetadata {
  vaNumber: string;
  bankCode: string;
  bankName: string;
  partnerUserId: string;
  usernameDisplay?: string;
  isOpen: boolean;
  isSingleUse: boolean;
}

export interface QrisMetadata {
  qrisUrl?: string;
  paymentReferenceNumber?: string;
  paymentMethod: string;
  senderBank?: string;
  needFrontend: boolean;
}

export interface DisbursementMetadata {
  remitId: string;
  recipientBank: string;
  recipientBankName: string;
  recipientAccount: string;
  recipientName: string;
  adminFee: number;
  notes?: string;
}

/**
 * Bank code to name mapping
 */
export const BANK_NAMES: Record<string, string> = {
  '002': 'BRI',
  '008': 'Mandiri',
  '009': 'BNI',
  '013': 'Permata',
  '022': 'CIMB Niaga',
  '014': 'BCA',
  '011': 'Danamon',
  '016': 'Maybank',
  '019': 'Panin',
  '023': 'UOB',
  '028': 'OCBC NISP',
  '426': 'Mega',
  '441': 'Bukopin',
  '451': 'BSI',
  '484': 'Sinarmas',
  '213': 'BTPN',
  '212': 'Woori Saudara',
  '490': 'Neo Commerce',
  '501': 'Jago',
  '503': 'Nobu',
  '506': 'Seabank',
  '535': 'Aladin',
  '542': 'Allo Bank',
  '547': 'BTPN Jenius',
  // E-wallets
  'ewallet_ovo': 'OVO',
  'ewallet_dana': 'DANA',
  'ewallet_gopay': 'GoPay',
  'ewallet_shopeepay': 'ShopeePay',
  'ewallet_linkaja': 'LinkAja',
};

/**
 * Map provider status to normalized status
 */
export function normalizeVaStatus(status: string): EventStatus {
  const map: Record<string, EventStatus> = {
    WAITING_PAYMENT: 'WAITING_PAYMENT',
    PAYMENT_DETECTED: 'PAYMENT_DETECTED',
    COMPLETE: 'SUCCESS',
    EXPIRED: 'EXPIRED',
  };
  return map[status] || 'PENDING';
}

export function normalizeQrisStatus(status: string): EventStatus {
  const map: Record<string, EventStatus> = {
    CREATED: 'PENDING',
    WAITING_PAYMENT: 'WAITING_PAYMENT',
    COMPLETE: 'SUCCESS',
    EXPIRED: 'EXPIRED',
    REFUND: 'CANCELLED',
  };
  return map[status] || 'PENDING';
}

export function normalizeDisbursementStatus(status: string): EventStatus {
  const map: Record<string, EventStatus> = {
    CREATED: 'PENDING',
    PENDING: 'PENDING',
    PROCESSING: 'PENDING',
    COMPLETE: 'SUCCESS',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
  };
  return map[status] || 'PENDING';
}
