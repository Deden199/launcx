// src/types/danarapay.types.ts

// ==================== COMMON ====================

export interface DanarapayStatus {
  code: string;
  message: string;
}

export interface DanarapayBaseResponse {
  status: DanarapayStatus;
}

// ==================== VA (Virtual Account) ====================

export const VA_BANK_CODES = {
  BRI: '002',
  MANDIRI: '008',
  BNI: '009',
  PERMATA: '013',
  CIMB: '022',
} as const;

export type VaBankCode = (typeof VA_BANK_CODES)[keyof typeof VA_BANK_CODES];

export interface CreateVaRequest {
  partner_user_id: string;
  bank_code: VaBankCode;
  amount?: number;
  is_open?: boolean; // true = open amount
  is_single_use?: boolean; // true = close after payment
  expiration_time?: number; // minutes
  is_lifetime?: boolean;
  username_display: string; // min 3 chars
  partner_trx_id?: string;
  trx_expiration_time?: number; // minutes
  trx_counter?: number;
  partner_callback_url?: string;
}

export interface CreateVaResponse extends DanarapayBaseResponse {
  id: string;
  va_number: string;
  bank_code: string;
  amount: number;
  partner_user_id: string;
  partner_trx_id: string;
  is_open: boolean;
  is_single_use: boolean;
  expiration_time: number; // timestamp ms
  trx_expiration_time: number; // timestamp ms
  va_status: VaStatus;
  username_display: string;
}

export type VaStatus =
  | 'WAITING_PAYMENT'
  | 'PAYMENT_DETECTED'
  | 'COMPLETE'
  | 'EXPIRED';

export interface UpdateVaRequest {
  amount?: number;
  is_open?: boolean;
  trx_expiration_time?: number;
  username_display?: string;
}

export interface VaInfoResponse extends DanarapayBaseResponse {
  id: string;
  va_number: string;
  bank_code: string;
  amount: number;
  partner_user_id: string;
  partner_trx_id: string;
  is_open: boolean;
  is_single_use: boolean;
  is_lifetime: boolean;
  expiration_time: number;
  trx_expiration_time: number;
  va_status: VaStatus;
  username_display: string;
  created: string;
  updated: string;
}

export interface VaCallbackPayload {
  id: string;
  va_number: string;
  bank_code: string;
  amount: number;
  partner_user_id: string;
  partner_trx_id: string;
  is_open: boolean;
  is_single_use: boolean;
  trx_id: string;
  tx_date: string;
  settlement_status: string;
  va_status: VaStatus;
}

// ==================== QRIS ====================

export interface CreateQrisRequest {
  partner_user_id?: string;
  partner_trx_id?: string;
  need_frontend: boolean;
  sender_email?: string;
  receive_amount: number;
  list_enable_payment_method: 'QRIS';
  list_enable_sof: 'QRIS';
  trx_expiration_time?: string;
}

export interface CreateQrisResponse extends DanarapayBaseResponse {
  trx_id: string;
  partner_trx_id: string;
  receive_amount: number;
  trx_expiration_time: string;
  payment_info: {
    qris_url?: string;
    payment_checkout_url?: string;
  };
  payment_method: string;
}

export type QrisStatus =
  | 'CREATED'
  | 'WAITING_PAYMENT'
  | 'COMPLETE'
  | 'EXPIRED'
  | 'REFUND';

export interface QrisStatusResponse extends DanarapayBaseResponse {
  trx_id: string;
  partner_trx_id: string;
  receive_amount: number;
  payment_status: QrisStatus;
  trx_expiration_time: string;
  payment_received_time?: string;
  settlement_time?: string;
  settlement_status?: string;
  payment_method?: string;
  sender_bank?: string;
  payment_info?: {
    qris_url?: string;
    payment_reference_number?: string;
  };
}

export interface QrisCallbackPayload {
  trx_id: string;
  partner_trx_id: string;
  receive_amount: number;
  payment_status: QrisStatus;
  trx_expiration_time: string;
  need_frontend: boolean;
  payment_received_time?: string;
  settlement_time?: string;
  settlement_status?: string;
  settlement_type?: string;
  payment_method?: string;
  sender_bank?: string;
  payment_info?: {
    qris_url?: string;
    payment_reference_number?: string;
    payment_checkout_url?: string;
  };
}

// ==================== DISBURSEMENT ====================

export interface CreateDisbursementRequest {
  partner_trx_id: string;
  recipient_bank: string;
  recipient_account: string;
  recipient_name: string;
  amount: number;
  notes?: string;
}

export interface CreateDisbursementResponse extends DanarapayBaseResponse {
  remit_id: string;
  partner_trx_id: string;
  recipient_bank: string;
  recipient_bank_name: string;
  recipient_account: string;
  recipient_name: string;
  amount: number;
  admin_fee: number;
  remit_status: DisbursementStatus;
  notes?: string;
  created: string;
}

export type DisbursementStatus =
  | 'CREATED'
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETE'
  | 'FAILED'
  | 'CANCELLED';

export interface DisbursementStatusRequest {
  partner_trx_id?: string;
  remit_id?: string;
}

export interface DisbursementStatusResponse extends DanarapayBaseResponse {
  remit_id: string;
  partner_trx_id: string;
  recipient_bank: string;
  recipient_bank_name: string;
  recipient_account: string;
  recipient_name: string;
  amount: number;
  admin_fee: number;
  remit_status: DisbursementStatus;
  notes?: string;
  created: string;
  updated: string;
  completed_at?: string;
}

export interface DisbursementBalanceResponse extends DanarapayBaseResponse {
  balance: number;
  overdraftBalance: number;
  overbookingBalance: number;
  pendingBalance: number;
  availableBalance: number;
  freezeBalance: number;
  holdBalance: number;
  timeStamp: string;
}

// ==================== ACCOUNT INQUIRY ====================

export interface AccountInquiryRequest {
  bank_code: string;
  account_number: string;
}

export interface AccountInquiryResponse extends DanarapayBaseResponse {
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  inquiry_id?: string;
}
