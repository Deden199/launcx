// File: src/service/danarapayClient.ts
// DanaRpay VA Aggregator Client
// ASSUMPTION: DanaRpay VA API follows standard VA aggregator pattern (similar to OY!)

import axios, { AxiosInstance, AxiosError } from 'axios';
import crypto from 'crypto';
import logger from '../logger';

export interface DanarapayConfig {
  baseUrl: string;
  merchantId: string;
  apiKey: string;
  secretKey: string;
  callbackUrl?: string;
}

// ===================== REQUEST TYPES =====================

export interface CreateVaRequest {
  /** Unique reference ID from merchant (idempotency key) */
  partnerTrxId: string;
  /** Bank code (e.g., BCA, BNI, MANDIRI, BRI, PERMATA, etc.) */
  bankCode: string;
  /** Amount in IDR (optional for open-amount VA) */
  amount?: number;
  /** Customer name */
  customerName: string;
  /** Customer email (optional) */
  customerEmail?: string;
  /** Customer phone (optional) */
  customerPhone?: string;
  /** VA expiration in minutes (optional) */
  expirationMinutes?: number;
  /** Description/notes (optional) */
  description?: string;
  /** Custom VA number suffix (optional, if supported) */
  customVaNumber?: string;
  /** Is single-use VA? (optional) */
  isSingleUse?: boolean;
  /** Is closed/fixed amount? (optional) */
  isClosed?: boolean;
  /** Additional metadata (optional) */
  metadata?: Record<string, any>;
}

export interface CreateVaResult {
  success: boolean;
  vaNumber?: string;
  bankCode?: string;
  bankName?: string;
  amount?: number;
  customerName?: string;
  expiredAt?: string | Date;
  partnerTrxId?: string;
  trxId?: string;
  status?: string;
  message?: string;
  responseCode?: string;
  raw: any;
}

export interface VaStatusResult {
  success: boolean;
  vaNumber?: string;
  bankCode?: string;
  amount?: number;
  paidAmount?: number;
  status?: string; // PENDING, PAID, EXPIRED, CANCELLED
  paidAt?: Date | null;
  expiredAt?: Date | null;
  partnerTrxId?: string;
  trxId?: string;
  message?: string;
  responseCode?: string;
  raw: any;
}

// ===================== CALLBACK TYPES =====================

export interface DanarapayVaCallbackPayload {
  /** Transaction ID from DanaRpay */
  trx_id?: string;
  /** Partner reference ID */
  partner_trx_id?: string;
  /** Virtual account number */
  va_number?: string;
  /** Bank code */
  bank_code?: string;
  /** Amount */
  amount?: number;
  /** Paid amount */
  paid_amount?: number;
  /** Status: PAID, EXPIRED, etc. */
  status?: string;
  /** Payment timestamp */
  paid_at?: string;
  /** Customer name */
  customer_name?: string;
  /** Signature for verification */
  signature?: string;
  /** Additional fields */
  [key: string]: any;
}

// ===================== HELPER FUNCTIONS =====================

const parseNumber = (value: any): number | undefined => {
  if (value == null) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const parseDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = typeof value === 'string' ? value.trim() : String(value);
  if (!str) return null;
  const timestamp = Date.parse(str);
  if (!Number.isNaN(timestamp)) return new Date(timestamp);
  return null;
};

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
    if (!config.merchantId) throw new Error('DanaRpay merchantId is required');
    if (!config.apiKey) throw new Error('DanaRpay apiKey is required');
    if (!config.secretKey) throw new Error('DanaRpay secretKey is required');

    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/+$/, ''),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });
  }

  // ===================== SIGNATURE =====================

  /**
   * Generate signature for API requests
   * ASSUMPTION: DanaRpay uses HMAC-SHA256 signature similar to other payment gateways
   * Format: HMAC-SHA256(merchantId + timestamp + body, secretKey)
   */
  private generateSignature(body: string, timestamp: string): string {
    const message = `${this.config.merchantId}${timestamp}${body}`;
    return crypto
      .createHmac('sha256', this.config.secretKey)
      .update(message)
      .digest('hex');
  }

  /**
   * Verify callback signature
   * ASSUMPTION: callback signature = HMAC-SHA256(rawBody, secretKey)
   */
  verifyCallbackSignature(rawBody: string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', this.config.secretKey)
      .update(rawBody)
      .digest('hex');
    
    // Constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(signature, 'hex')
      );
    } catch {
      return expected.toLowerCase() === signature.toLowerCase();
    }
  }

  /**
   * Alternative signature verification (some providers use different format)
   */
  verifyCallbackSignatureAlt(payload: DanarapayVaCallbackPayload, signature: string): boolean {
    // ASSUMPTION: signature = SHA256(trx_id + partner_trx_id + amount + status + secretKey)
    const message = `${payload.trx_id || ''}${payload.partner_trx_id || ''}${payload.amount || ''}${payload.status || ''}${this.config.secretKey}`;
    const expected = crypto.createHash('sha256').update(message).digest('hex');
    return expected.toLowerCase() === signature.toLowerCase();
  }

  // ===================== API METHODS =====================

  /**
   * Create Virtual Account
   */
  async createVa(request: CreateVaRequest): Promise<CreateVaResult> {
    const timestamp = new Date().toISOString();
    
    const body = clean({
      merchant_id: this.config.merchantId,
      partner_trx_id: request.partnerTrxId,
      bank_code: request.bankCode,
      amount: request.amount,
      customer_name: request.customerName,
      customer_email: request.customerEmail,
      customer_phone: request.customerPhone,
      expiration_time: request.expirationMinutes,
      description: request.description,
      va_number: request.customVaNumber,
      is_single_use: request.isSingleUse,
      is_closed: request.isClosed,
      callback_url: this.config.callbackUrl,
      metadata: request.metadata,
    });

    const bodyString = JSON.stringify(body);
    const signature = this.generateSignature(bodyString, timestamp);

    const headers = {
      'X-API-Key': this.config.apiKey,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'X-Merchant-Id': this.config.merchantId,
    };

    try {
      logger.info('[DanaRpay] ▶ createVa', { partnerTrxId: request.partnerTrxId, bankCode: request.bankCode });
      
      const res = await this.http.post('/api/v1/va/create', body, { headers });
      
      logger.info('[DanaRpay] ◀ createVa', { status: res.status, data: res.data });

      const data = res.data?.data ?? res.data;

      return {
        success: this.isSuccessResponse(res.data),
        vaNumber: data?.va_number ?? data?.virtual_account_number,
        bankCode: data?.bank_code ?? request.bankCode,
        bankName: data?.bank_name,
        amount: parseNumber(data?.amount ?? request.amount),
        customerName: data?.customer_name ?? request.customerName,
        expiredAt: data?.expired_at ?? data?.expiration_time,
        partnerTrxId: data?.partner_trx_id ?? request.partnerTrxId,
        trxId: data?.trx_id ?? data?.transaction_id,
        status: data?.status ?? 'PENDING',
        message: res.data?.message,
        responseCode: res.data?.code ?? res.data?.response_code,
        raw: res.data,
      };
    } catch (err) {
      const { raw, message, code } = this.extractError(err);
      logger.error('[DanaRpay] ✖ createVa error', { error: message, code });
      return {
        success: false,
        partnerTrxId: request.partnerTrxId,
        message,
        responseCode: code,
        raw,
      };
    }
  }

  /**
   * Get VA Status / Inquiry
   */
  async getVaStatus(partnerTrxId: string): Promise<VaStatusResult> {
    const timestamp = new Date().toISOString();
    
    const body = clean({
      merchant_id: this.config.merchantId,
      partner_trx_id: partnerTrxId,
    });

    const bodyString = JSON.stringify(body);
    const signature = this.generateSignature(bodyString, timestamp);

    const headers = {
      'X-API-Key': this.config.apiKey,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'X-Merchant-Id': this.config.merchantId,
    };

    try {
      logger.info('[DanaRpay] ▶ getVaStatus', { partnerTrxId });
      
      const res = await this.http.post('/api/v1/va/status', body, { headers });
      
      logger.info('[DanaRpay] ◀ getVaStatus', { status: res.status, data: res.data });

      const data = res.data?.data ?? res.data;

      return {
        success: this.isSuccessResponse(res.data),
        vaNumber: data?.va_number ?? data?.virtual_account_number,
        bankCode: data?.bank_code,
        amount: parseNumber(data?.amount),
        paidAmount: parseNumber(data?.paid_amount),
        status: data?.status,
        paidAt: parseDate(data?.paid_at ?? data?.payment_time),
        expiredAt: parseDate(data?.expired_at ?? data?.expiration_time),
        partnerTrxId: data?.partner_trx_id ?? partnerTrxId,
        trxId: data?.trx_id ?? data?.transaction_id,
        message: res.data?.message,
        responseCode: res.data?.code ?? res.data?.response_code,
        raw: res.data,
      };
    } catch (err) {
      const { raw, message, code } = this.extractError(err);
      logger.error('[DanaRpay] ✖ getVaStatus error', { error: message, code });
      return {
        success: false,
        partnerTrxId,
        message,
        responseCode: code,
        raw,
      };
    }
  }

  /**
   * Get available bank channels
   * ASSUMPTION: DanaRpay provides an endpoint to list available banks
   */
  async getBankChannels(): Promise<{ success: boolean; banks: any[]; raw: any }> {
    const timestamp = new Date().toISOString();
    const body = { merchant_id: this.config.merchantId };
    const bodyString = JSON.stringify(body);
    const signature = this.generateSignature(bodyString, timestamp);

    const headers = {
      'X-API-Key': this.config.apiKey,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'X-Merchant-Id': this.config.merchantId,
    };

    try {
      logger.info('[DanaRpay] ▶ getBankChannels');
      const res = await this.http.get('/api/v1/va/banks', { headers });
      logger.info('[DanaRpay] ◀ getBankChannels', { data: res.data });

      const data = res.data?.data ?? res.data;
      return {
        success: this.isSuccessResponse(res.data),
        banks: Array.isArray(data?.banks) ? data.banks : (Array.isArray(data) ? data : []),
        raw: res.data,
      };
    } catch (err) {
      const { raw, message } = this.extractError(err);
      logger.error('[DanaRpay] ✖ getBankChannels error', { error: message });
      return { success: false, banks: [], raw };
    }
  }

  // ===================== HELPERS =====================

  private isSuccessResponse(data: any): boolean {
    if (!data) return false;
    const code = String(data?.code ?? data?.response_code ?? data?.status_code ?? '');
    const status = String(data?.status ?? '').toUpperCase();
    
    // Common success indicators
    return (
      code === '00' ||
      code === '000' ||
      code === '200' ||
      code === 'SUCCESS' ||
      status === 'SUCCESS' ||
      status === 'CREATED' ||
      status === 'PENDING' ||
      data?.success === true
    );
  }

  private extractError(error: any): { raw: any; message?: string; code?: string } {
    if (!error) return { raw: error };
    
    if (error instanceof Error && !(error as AxiosError).isAxiosError) {
      return { raw: error, message: error.message };
    }

    const axiosErr = error as AxiosError<any>;
    const payload = axiosErr.response?.data ?? axiosErr.toJSON?.() ?? axiosErr;
    const message =
      payload?.message ??
      payload?.error ??
      payload?.errorMessage ??
      axiosErr.message;
    const code =
      payload?.code ?? payload?.errorCode ?? payload?.error_code ?? payload?.statusCode;

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
