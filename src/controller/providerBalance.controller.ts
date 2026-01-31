// src/controller/providerBalance.controller.ts
// Endpoint untuk cek balance provider (DanaRapay) sebagai guardrail global

import { Response } from 'express';
import { ClientAuthRequest } from '../middleware/clientAuth';
import { DanarapayClient, DanarapayConfig } from '../service/danarapayClient';
import { config } from '../config';
import logger from '../logger';

// Singleton client untuk DanaRapay balance check (menggunakan credentials global)
let danarapayClientInstance: DanarapayClient | null = null;

function getDanarapayClientGlobal(): DanarapayClient | null {
  if (danarapayClientInstance) return danarapayClientInstance;

  const { baseUrl, username, apiKey } = config.api.danarapay;
  
  if (!baseUrl || !username || !apiKey) {
    logger.warn('[ProviderBalance] DanaRapay credentials not configured');
    return null;
  }

  const cfg: DanarapayConfig = {
    baseUrl,
    username,
    apiKey,
  };

  danarapayClientInstance = new DanarapayClient(cfg);
  return danarapayClientInstance;
}

/**
 * GET /api/v1/client/provider-balance
 * 
 * Mendapatkan balance dari provider DanaRapay (akun utama)
 * Digunakan sebagai guardrail global untuk mencegah overdraw
 */
export const getProviderBalance = async (req: ClientAuthRequest, res: Response) => {
  try {
    const client = getDanarapayClientGlobal();
    
    if (!client) {
      return res.status(503).json({
        error: 'Provider balance service not configured',
        provider: 'danarapay',
        available: false,
      });
    }

    const result = await client.getBalance();

    if (!result.success) {
      logger.error('[ProviderBalance] DanaRapay getBalance failed', {
        status: result.status,
      });
      return res.status(502).json({
        error: result.status?.message || 'Failed to fetch provider balance',
        provider: 'danarapay',
        available: false,
      });
    }

    // Return essential balance info untuk client
    // Detail lengkap hanya untuk logging/admin
    return res.json({
      provider: 'danarapay',
      available: true,
      balance: result.availableBalance,          // Saldo yang bisa digunakan
      onHold: result.pendingBalance + result.holdBalance + result.freezeBalance, // Gabungan "On Hold"
      timestamp: result.timestamp || new Date().toISOString(),
      // Raw data untuk debugging (bisa dihapus di production)
      _debug: process.env.NODE_ENV !== 'production' ? {
        totalBalance: result.balance,
        availableBalance: result.availableBalance,
        pendingBalance: result.pendingBalance,
        holdBalance: result.holdBalance,
        freezeBalance: result.freezeBalance,
        overdraftBalance: result.overdraftBalance,
        overbookingBalance: result.overbookingBalance,
      } : undefined,
    });
  } catch (err: any) {
    logger.error('[ProviderBalance] Unexpected error', err);
    return res.status(500).json({
      error: err.message || 'Internal server error',
      provider: 'danarapay',
      available: false,
    });
  }
};

/**
 * Reset singleton client (untuk testing)
 */
export const resetProviderBalanceClient = () => {
  danarapayClientInstance = null;
};
