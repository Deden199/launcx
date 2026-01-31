// src/services/danarapay.client.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import { config, getDanarapayUrl } from '../config';
import { logger } from '../utils/logger';
import { withRetry, isRetryableError } from '../utils/retry';
import {
  CreateVaRequest,
  CreateVaResponse,
  UpdateVaRequest,
  VaInfoResponse,
  CreateQrisRequest,
  CreateQrisResponse,
  QrisStatusResponse,
  CreateDisbursementRequest,
  CreateDisbursementResponse,
  DisbursementStatusRequest,
  DisbursementStatusResponse,
  DisbursementBalanceResponse,
  AccountInquiryRequest,
  AccountInquiryResponse,
  DanarapayBaseResponse,
} from '../types/danarapay.types';

class DanarapayClient {
  private client: AxiosInstance;
  private requestId: number = 0;

  constructor() {
    this.client = axios.create({
      baseURL: getDanarapayUrl(),
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'x-username': config.danarapay.username,
        'x-api-key': config.danarapay.apiKey,
      },
    });

    // Request interceptor for logging
    this.client.interceptors.request.use((req) => {
      const id = ++this.requestId;
      (req as any)._requestId = id;
      logger.info(
        {
          requestId: id,
          method: req.method?.toUpperCase(),
          url: req.url,
          body: req.data,
        },
        'DanaRapay API request'
      );
      return req;
    });

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (res) => {
        const id = (res.config as any)._requestId;
        logger.info(
          {
            requestId: id,
            status: res.status,
            data: res.data,
          },
          'DanaRapay API response'
        );
        return res;
      },
      (err: AxiosError) => {
        const id = (err.config as any)?._requestId;
        logger.error(
          {
            requestId: id,
            status: err.response?.status,
            data: err.response?.data,
            message: err.message,
          },
          'DanaRapay API error'
        );
        return Promise.reject(err);
      }
    );
  }

  // ==================== VA ====================

  async createVa(request: CreateVaRequest): Promise<CreateVaResponse> {
    return withRetry(
      async () => {
        const { data } = await this.client.post<CreateVaResponse>(
          '/api/generate-static-va',
          request
        );
        this.assertSuccess(data, 'createVa');
        return data;
      },
      'createVa',
      { shouldRetry: isRetryableError }
    );
  }

  async getVaInfo(vaId: string): Promise<VaInfoResponse> {
    return withRetry(
      async () => {
        const { data } = await this.client.get<VaInfoResponse>(
          `/api/static-virtual-account/${vaId}`
        );
        this.assertSuccess(data, 'getVaInfo');
        return data;
      },
      'getVaInfo',
      { shouldRetry: isRetryableError }
    );
  }

  async updateVa(vaId: string, request: UpdateVaRequest): Promise<VaInfoResponse> {
    return withRetry(
      async () => {
        const { data } = await this.client.put<VaInfoResponse>(
          `/api/static-virtual-account/${vaId}`,
          request
        );
        this.assertSuccess(data, 'updateVa');
        return data;
      },
      'updateVa',
      { shouldRetry: isRetryableError }
    );
  }

  async deactivateVa(vaId: string): Promise<VaInfoResponse> {
    return this.updateVa(vaId, { expiration_time: 0 } as any);
  }

  // ==================== QRIS ====================

  async createQris(request: CreateQrisRequest): Promise<CreateQrisResponse> {
    return withRetry(
      async () => {
        const { data } = await this.client.post<CreateQrisResponse>(
          '/api/payment-routing/create-transaction',
          request
        );
        this.assertSuccess(data, 'createQris');
        return data;
      },
      'createQris',
      { shouldRetry: isRetryableError }
    );
  }

  async getQrisStatus(partnerTrxId: string): Promise<QrisStatusResponse> {
    return withRetry(
      async () => {
        const { data } = await this.client.post<QrisStatusResponse>(
          '/api/payment-routing/check-status',
          { partner_trx_id: partnerTrxId }
        );
        this.assertSuccess(data, 'getQrisStatus');
        return data;
      },
      'getQrisStatus',
      { shouldRetry: isRetryableError }
    );
  }

  // ==================== DISBURSEMENT ====================

  async createDisbursement(
    request: CreateDisbursementRequest
  ): Promise<CreateDisbursementResponse> {
    return withRetry(
      async () => {
        const { data } = await this.client.post<CreateDisbursementResponse>(
          '/api/remit',
          request
        );
        this.assertSuccess(data, 'createDisbursement');
        return data;
      },
      'createDisbursement',
      { shouldRetry: isRetryableError }
    );
  }

  async getDisbursementStatus(
    request: DisbursementStatusRequest
  ): Promise<DisbursementStatusResponse> {
    return withRetry(
      async () => {
        const { data } = await this.client.post<DisbursementStatusResponse>(
          '/api/remit-status',
          request
        );
        this.assertSuccess(data, 'getDisbursementStatus');
        return data;
      },
      'getDisbursementStatus',
      { shouldRetry: isRetryableError }
    );
  }

  async getDisbursementBalance(): Promise<DisbursementBalanceResponse> {
    return withRetry(
      async () => {
        const { data } = await this.client.get<DisbursementBalanceResponse>(
          '/api/disbursement-balance'
        );
        this.assertSuccess(data, 'getDisbursementBalance');
        return data;
      },
      'getDisbursementBalance',
      { shouldRetry: isRetryableError }
    );
  }

  // ==================== ACCOUNT INQUIRY ====================

  async accountInquiry(
    request: AccountInquiryRequest
  ): Promise<AccountInquiryResponse> {
    return withRetry(
      async () => {
        const { data } = await this.client.post<AccountInquiryResponse>(
          '/api/account-inquiry',
          request
        );
        this.assertSuccess(data, 'accountInquiry');
        return data;
      },
      'accountInquiry',
      { shouldRetry: isRetryableError }
    );
  }

  // ==================== SIMULATION (Staging only) ====================

  async simulateVaCallback(vaId: string, amount?: number): Promise<void> {
    if (config.isProduction) {
      throw new Error('simulateVaCallback is only available in staging');
    }
    const { data } = await this.client.post('/api/va-aggregator/simulate-callback', {
      id: vaId,
      amount,
    });
    this.assertSuccess(data, 'simulateVaCallback');
  }

  async simulateQrisCallback(trxId: string): Promise<void> {
    if (config.isProduction) {
      throw new Error('simulateQrisCallback is only available in staging');
    }
    const { data } = await this.client.post(
      '/api/payment-routing/simulate-callback',
      { trx_id: trxId }
    );
    this.assertSuccess(data, 'simulateQrisCallback');
  }

  // ==================== HELPERS ====================

  private assertSuccess(response: DanarapayBaseResponse, operation: string): void {
    if (response.status?.code !== '000') {
      const error = new Error(
        `DanaRapay ${operation} failed: ${response.status?.message || 'Unknown error'}`
      );
      (error as any).code = response.status?.code;
      (error as any).response = response;
      throw error;
    }
  }
}

// Singleton instance
let instance: DanarapayClient | null = null;

export function getDanarapayClient(): DanarapayClient {
  if (!instance) {
    instance = new DanarapayClient();
  }
  return instance;
}

export { DanarapayClient };
