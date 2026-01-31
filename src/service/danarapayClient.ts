// File: src/service/danarapayClient.ts
// DanaRpay VA Aggregator Client - Based on official API docs v1.2.4
// Docs: https://api-docs.danarapay.com/#tag/VA-Aggregator

import axios, { AxiosInstance, AxiosError } from 'axios';
import logger from '../logger';

export interface DanarapayConfig {
  baseUrl: string;       // https://partner.danarapay.com (prod) | https://api-stg.danarapay.com (staging)
  username: string;      // x-username header
  apiKey: string;        // x-api-key header
}

// ===================== VA BANK CODES =====================
// Supported banks for VA Aggregator per DanaRpay docs
export const VA_BANK_CODES = {
  BRI: '002',
  MANDIRI: '008',
  BNI: '009',
  PERMATA: '013',
  CIMB: '022',
} as const;

// ===================== VA STATUS =====================
export type VaStatus = 
  | 'WAITING_PAYMENT'     // VA is active and can receive payment
  | 'PAYMENT_DETECTED'    // Incoming payment to the VA Number
  | 'EXPIRED'             // VA is expired
  | 'STATIC_TRX_EXPIRED'  // Transaction expired (lifetime VA can update)
  | 'COMPLETE';           // VA closed after payment (single_use=true)

// ===================== REQUEST TYPES =====================

export interface CreateVaRequest {
  /** Partner unique identifier for specific user (required) */
  partner_user_id: string;
  /** Bank code: 002 (BRI), 008 (Mandiri), 009 (BNI), 013 (Permata), 022 (CIMB) (required) */
  bank_code: string;
  /** Amount in IDR, required if is_open=false */
  amount?: number;
  /** true = open amount, false = closed amount (default: true) */
  is_open?: boolean;
  /** true = close VA after successful payment (default: false) */
  is_single_use?: boolean;
  /** VA expiration time in minutes, default 24 hours */
  expiration_time?: number;
  /** true = VA never expires (default: false) */
  is_lifetime?: boolean;
  /** Display name shown to user, min 3 chars (required) */
  username_display: string;
  /** User email */
  email?: string;
  /** End-user full name (required for some banks) */
  full_name?: string;
  /** Transaction expiration time in minutes */
  trx_expiration_time?: number;
  /** Partner unique transaction ID */
  partner_trx_id?: string;
  /** Transaction counter limit, -1 for unlimited */
  trx_counter?: number;
}

export interface CreateVaResult {
  success: boolean;
  status?: { code: string; message: string };
  id?: string;              // Unique VA ID from DanaRpay
  va_number?: string;       // Generated VA number
  bank_code?: string;
  bank_name?: string;
  amount?: number;
  partner_user_id?: string;
  partner_trx_id?: string;
  is_open?: boolean;
  is_single_use?: boolean;
  expiration_time?: number;
  trx_expiration_time?: number;
  va_status?: VaStatus;
  username_display?: string;
  trx_counter?: number;
  counter_incoming_payment?: number;
  full_name?: string;
  raw: any;
}

export interface GetVaInfoResult {
  success: boolean;
  status?: { code: string; message: string };
  id?: string;
  va_number?: string;
  bank_code?: string;
  bank_name?: string;
  amount?: number;
  partner_user_id?: string;
  partner_trx_id?: string;
  created?: number;         // Unix timestamp ms
  is_open?: boolean;
  is_single_use?: boolean;
  expiration_time?: number;
  trx_expiration_time?: number;
  va_status?: VaStatus;
  username_display?: string;
  trx_counter?: number;
  counter_incoming_payment?: number;
  email?: string;
  full_name?: string;
  raw: any;
}

export interface UpdateVaRequest {
  amount?: number;
  is_single_use?: boolean;
  /** Set to 0 to deactivate/cancel the VA */
  expiration_time?: number;
  username_display?: string;
  email?: string;
  is_lifetime?: boolean;
  /** Set to 0 to expire the transaction */
  trx_expiration_time?: number;
  partner_trx_id?: string;
  trx_counter?: number;
}

// ===================== DISBURSEMENT/REMIT TYPES =====================

export interface DanarapayRemitRequest {
  /** Partner unique transaction ID (required) - use withdrawRequest.id */
  partner_trx_id: string;
  /** Bank code per BI standard (required) - e.g. 014 for BCA */
  bank_code: string;
  /** Recipient bank account number (required) */
  account_number: string;
  /** Recipient account holder name (required) */
  account_holder_name: string;
  /** Amount in IDR (required) */
  amount: number;
  /** Optional notes/description */
  notes?: string;
}

export interface DanarapayRemitResult {
  success: boolean;
  pending: boolean;
  status?: { code: string; message: string };
  /** DanaRapay transaction ID */
  trx_id?: string;
  partner_trx_id?: string;
  bank_code?: string;
  account_number?: string;
  account_holder_name?: string;
  amount?: number;
  notes?: string;
  raw: any;
}

// ===================== CALLBACK TYPES =====================

export interface DanarapayVaCallbackPayload {
  /** Generated VA number */
  va_number: string;
  /** Amount of VA transaction */
  amount: number;
  /** Partner unique ID for specific user */
  partner_user_id: string;
  /** Payment status, always "true" on success */
  success: string | boolean;
  /** Incoming payment transaction date (dd/MM/yyyy'T'HH:mm:ss.SSSZZZZ) */
  tx_date: string;
  /** VA display name */
  username_display: string;
  /** Transaction expiration date */
  trx_expiration_date?: string;
  /** Partner unique transaction ID (if provided at creation) */
  partner_trx_id?: string;
  /** Unique ID of incoming payment */
  trx_id?: string;
  /** Settlement timestamp (UTC+7) */
  settlement_time?: string;
  /** Settlement status: WAITING | SUCCESS */
  settlement_status?: 'WAITING' | 'SUCCESS';
  /** End-user full name */
  full_name?: string;
}

// ===================== HELPER FUNCTIONS =====================

const clean = <T extends Record<string, any>>(payload: T): T => {
  const clone: Record<string, any> = {};
  Object.entries(payload).forEach(([key, val]) => {
    if (val === undefined || val === null) return;
    if (typeof val === 'object' && !Array.isArray(val)) {
      const nested = clean(val as Record<string, any>);
      if (Object.keys(nested).length === 0) return;
      clone[key] = nested;
    } else {
      clone[key] = val;
    }
  });
  return clone as T;
};

// ===================== DANARAPAY CLIENT =====================

export class DanarapayClient {
  private http: AxiosInstance;

  constructor(private readonly config: DanarapayConfig) {
    if (!config.baseUrl) throw new Error('DanaRpay baseUrl is required');
    if (!config.username) throw new Error('DanaRpay username is required');
    if (!config.apiKey) throw new Error('DanaRpay apiKey is required');

    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/+$/, ''),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-username': config.username,
        'x-api-key': config.apiKey,
      },
      timeout: 30000,
    });
  }

  // ===================== CREATE VA =====================
  /**
   * Create new Virtual Account
   * POST /api/generate-static-va
   */
  async createVa(request: CreateVaRequest): Promise<CreateVaResult> {
    const body = clean({
      partner_user_id: request.partner_user_id,
      bank_code: request.bank_code,
      amount: request.amount,
      is_open: request.is_open,
      is_single_use: request.is_single_use,
      expiration_time: request.expiration_time,
      is_lifetime: request.is_lifetime,
      username_display: request.username_display,
      email: request.email,
      full_name: request.full_name,
      trx_expiration_time: request.trx_expiration_time,
      partner_trx_id: request.partner_trx_id,
      trx_counter: request.trx_counter,
    });

    try {
      logger.info('[DanaRpay] ▶ createVa', { 
        partner_user_id: request.partner_user_id, 
        bank_code: request.bank_code,
        partner_trx_id: request.partner_trx_id,
      });
      
      const res = await this.http.post('/api/generate-static-va', body);
      
      logger.info('[DanaRpay] ◀ createVa', { status: res.status, data: res.data });

      const data = res.data;
      const isSuccess = data?.status?.code === '000';

      return {
        success: isSuccess,
        status: data?.status,
        id: data?.id,
        va_number: data?.va_number,
        bank_code: data?.bank_code,
        amount: data?.amount,
        partner_user_id: data?.partner_user_id,
        partner_trx_id: data?.partner_trx_id,
        is_open: data?.is_open,
        is_single_use: data?.is_single_use,
        expiration_time: data?.expiration_time,
        trx_expiration_time: data?.trx_expiration_time,
        va_status: data?.va_status,
        username_display: data?.username_display,
        trx_counter: data?.trx_counter,
        counter_incoming_payment: data?.counter_incoming_payment,
        full_name: data?.full_name,
        raw: data,
      };
    } catch (err) {
      const { raw, message, code } = this.extractError(err);
      logger.error('[DanaRpay] ✖ createVa error', { error: message, code });
      return {
        success: false,
        status: { code: code ?? '999', message: message ?? 'Unknown error' },
        raw,
      };
    }
  }

  // ===================== GET VA INFO =====================
  /**
   * Get VA info by unique VA ID
   * GET /api/static-virtual-account/{id}
   */
  async getVaInfo(vaId: string): Promise<GetVaInfoResult> {
    try {
      logger.info('[DanaRpay] ▶ getVaInfo', { vaId });
      
      const res = await this.http.get(`/api/static-virtual-account/${encodeURIComponent(vaId)}`);
      
      logger.info('[DanaRpay] ◀ getVaInfo', { status: res.status, data: res.data });

      const data = res.data;
      const isSuccess = data?.status?.code === '000';

      return {
        success: isSuccess,
        status: data?.status,
        id: data?.id,
        va_number: data?.va_number,
        bank_code: data?.bank_code,
        bank_name: data?.bank_name,
        amount: data?.amount,
        partner_user_id: data?.partner_user_id,
        partner_trx_id: data?.partner_trx_id,
        created: data?.created,
        is_open: data?.is_open,
        is_single_use: data?.is_single_use,
        expiration_time: data?.expiration_time,
        trx_expiration_time: data?.trx_expiration_time,
        va_status: data?.va_status,
        username_display: data?.username_display,
        trx_counter: data?.trx_counter,
        counter_incoming_payment: data?.counter_incoming_payment,
        email: data?.email,
        full_name: data?.full_name,
        raw: data,
      };
    } catch (err) {
      const { raw, message, code } = this.extractError(err);
      logger.error('[DanaRpay] ✖ getVaInfo error', { error: message, code });
      return {
        success: false,
        status: { code: code ?? '999', message: message ?? 'Unknown error' },
        raw,
      };
    }
  }

  // ===================== UPDATE VA =====================
  /**
   * Update VA by unique VA ID
   * PUT /api/static-virtual-account/{ID}
   */
  async updateVa(vaId: string, request: UpdateVaRequest): Promise<GetVaInfoResult> {
    const body = clean({
      amount: request.amount,
      is_single_use: request.is_single_use,
      expiration_time: request.expiration_time,
      username_display: request.username_display,
      email: request.email,
      is_lifetime: request.is_lifetime,
      trx_expiration_time: request.trx_expiration_time,
      partner_trx_id: request.partner_trx_id,
      trx_counter: request.trx_counter,
    });

    try {
      logger.info('[DanaRpay] ▶ updateVa', { vaId, body });
      
      const res = await this.http.put(`/api/static-virtual-account/${encodeURIComponent(vaId)}`, body);
      
      logger.info('[DanaRpay] ◀ updateVa', { status: res.status, data: res.data });

      const data = res.data;
      const isSuccess = data?.status?.code === '000';

      return {
        success: isSuccess,
        status: data?.status,
        id: data?.id,
        va_number: data?.va_number,
        bank_code: data?.bank_code,
        amount: data?.amount,
        partner_user_id: data?.partner_user_id,
        partner_trx_id: data?.partner_trx_id,
        is_open: data?.is_open,
        is_single_use: data?.is_single_use,
        expiration_time: data?.expiration_time,
        trx_expiration_time: data?.trx_expiration_time,
        va_status: data?.va_status,
        username_display: data?.username_display,
        trx_counter: data?.trx_counter,
        counter_incoming_payment: data?.counter_incoming_payment,
        full_name: data?.full_name,
        raw: data,
      };
    } catch (err) {
      const { raw, message, code } = this.extractError(err);
      logger.error('[DanaRpay] ✖ updateVa error', { error: message, code });
      return {
        success: false,
        status: { code: code ?? '999', message: message ?? 'Unknown error' },
        raw,
      };
    }
  }

  // ===================== SIMULATE CALLBACK (STAGING ONLY) =====================
  /**
   * Simulate VA payment callback (staging environment only)
   * POST /api/va-aggregator/simulate-callback
   */
  async simulateCallback(vaId: string, amount: number): Promise<{ success: boolean; error?: any; raw: any }> {
    try {
      logger.info('[DanaRpay] ▶ simulateCallback', { vaId, amount });
      
      const res = await this.http.post('/api/va-aggregator/simulate-callback', {
        id: vaId,
        amount,
      });
      
      logger.info('[DanaRpay] ◀ simulateCallback', { data: res.data });

      return {
        success: res.data?.success === true,
        error: res.data?.error,
        raw: res.data,
      };
    } catch (err) {
      const { raw, message } = this.extractError(err);
      logger.error('[DanaRpay] ✖ simulateCallback error', { error: message });
      return { success: false, error: message, raw };
    }
  }

  // ===================== DISBURSEMENT / REMIT =====================
  /**
   * Create disbursement (remit/transfer) to bank account
   * POST /api/remit
   * 
   * @see https://api-docs.danarapay.com/#tag/Disbursement
   */
  async remit(request: DanarapayRemitRequest): Promise<DanarapayRemitResult> {
    const body = clean({
      partner_trx_id: request.partner_trx_id,
      bank_code: request.bank_code,
      account_number: request.account_number,
      account_holder_name: request.account_holder_name,
      amount: request.amount,
      notes: request.notes,
    });

    try {
      logger.info('[DanaRpay] ▶ remit (disbursement)', { 
        partner_trx_id: request.partner_trx_id, 
        bank_code: request.bank_code,
        amount: request.amount,
      });
      
      const res = await this.http.post('/api/remit', body);
      
      logger.info('[DanaRpay] ◀ remit', { status: res.status, data: res.data });

      const data = res.data;
      const statusCode = data?.status?.code;
      // 000 = Success, 101/102/301/504/999 = Pending, others = Failed
      const isSuccess = statusCode === '000';
      const isPending = ['101', '102', '301', '504', '999'].includes(statusCode);

      return {
        success: isSuccess,
        pending: isPending,
        status: data?.status,
        trx_id: data?.trx_id,           // DanaRapay transaction ID
        partner_trx_id: data?.partner_trx_id,
        bank_code: data?.bank_code,
        account_number: data?.account_number,
        account_holder_name: data?.account_holder_name,
        amount: data?.amount,
        notes: data?.notes,
        raw: data,
      };
    } catch (err) {
      const { raw, message, code } = this.extractError(err);
      logger.error('[DanaRpay] ✖ remit error', { error: message, code });
      return {
        success: false,
        pending: false,
        status: { code: code ?? '999', message: message ?? 'Unknown error' },
        raw,
      };
    }
  }

  // ===================== GET BALANCE =====================
  /**
   * Get balance information
   * GET /api/balance
   * 
   * @see https://api-docs.danarapay.com/#tag/Disbursement
   */
  async getBalance(): Promise<DanarapayBalanceResult> {
    try {
      logger.info('[DanaRpay] ▶ getBalance');
      
      const res = await this.http.get('/api/balance');
      
      logger.info('[DanaRpay] ◀ getBalance', { status: res.status, data: res.data });

      const data = res.data;
      const isSuccess = data?.status?.code === '000';

      return {
        success: isSuccess,
        status: data?.status,
        balance: data?.balance ?? 0,
        overdraftBalance: data?.overdraftBalance ?? 0,
        overbookingBalance: data?.overbookingBalance ?? 0,
        pendingBalance: data?.pendingBalance ?? 0,
        availableBalance: data?.availableBalance ?? 0,
        freezeBalance: data?.freezeBalance ?? 0,
        holdBalance: data?.holdBalance ?? 0,
        timestamp: data?.timeStamp,
        raw: data,
      };
    } catch (err) {
      const { raw, message, code } = this.extractError(err);
      logger.error('[DanaRpay] ✖ getBalance error', { error: message, code });
      return {
        success: false,
        status: { code: code ?? '999', message: message ?? 'Unknown error' },
        balance: 0,
        overdraftBalance: 0,
        overbookingBalance: 0,
        pendingBalance: 0,
        availableBalance: 0,
        freezeBalance: 0,
        holdBalance: 0,
        raw,
      };
    }
  }

  /**
   * Check disbursement status
   * GET /api/remit/status/{partner_trx_id}
   */
  async getRemitStatus(partnerTrxId: string): Promise<DanarapayRemitResult> {
    try {
      logger.info('[DanaRpay] ▶ getRemitStatus', { partner_trx_id: partnerTrxId });
      
      const res = await this.http.get(`/api/remit/status/${encodeURIComponent(partnerTrxId)}`);
      
      logger.info('[DanaRpay] ◀ getRemitStatus', { status: res.status, data: res.data });

      const data = res.data;
      const statusCode = data?.status?.code;
      const isSuccess = statusCode === '000';
      const isPending = ['101', '102', '301', '504', '999'].includes(statusCode);

      return {
        success: isSuccess,
        pending: isPending,
        status: data?.status,
        trx_id: data?.trx_id,
        partner_trx_id: data?.partner_trx_id,
        bank_code: data?.bank_code,
        account_number: data?.account_number,
        account_holder_name: data?.account_holder_name,
        amount: data?.amount,
        raw: data,
      };
    } catch (err) {
      const { raw, message, code } = this.extractError(err);
      logger.error('[DanaRpay] ✖ getRemitStatus error', { error: message, code });
      return {
        success: false,
        pending: false,
        status: { code: code ?? '999', message: message ?? 'Unknown error' },
        raw,
      };
    }
  }

  // ===================== HELPERS =====================

  private extractError(error: any): { raw: any; message?: string; code?: string } {
    if (!error) return { raw: error };
    
    if (error instanceof Error && !(error as AxiosError).isAxiosError) {
      return { raw: error, message: error.message };
    }

    const axiosErr = error as AxiosError<any>;
    const payload = axiosErr.response?.data ?? axiosErr.toJSON?.() ?? axiosErr;
    const message =
      payload?.status?.message ??
      payload?.message ??
      payload?.error ??
      axiosErr.message;
    const code =
      payload?.status?.code ??
      payload?.code ?? 
      payload?.statusCode;

    return {
      raw: payload,
      message: typeof message === 'string' ? message : undefined,
      code: typeof code === 'string' || typeof code === 'number' ? String(code) : undefined,
    };
  }
}

// ===================== SINGLETON FACTORY =====================

let clientInstance: DanarapayClient | null = null;

export function getDanarapayClient(config: DanarapayConfig): DanarapayClient {
  if (!clientInstance) {
    clientInstance = new DanarapayClient(config);
  }
  return clientInstance;
}

export function resetDanarapayClient(): void {
  clientInstance = null;
}
