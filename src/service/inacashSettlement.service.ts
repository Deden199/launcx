import { prisma } from '../core/prisma';
import { Ing1Client, Ing1Config } from './ing1Client';
import { getActiveProviders } from './provider';
import logger from '../logger';

/**
 * Inacash Settlement Service
 * Handles settlement synchronization with INA/ING1 payment provider
 * Based on Hilogate settlement pattern
 */

/**
 * Sync a single transaction with Inacash (INA/ING1)
 * Fetches the latest transaction status and updates order settlement data
 */
export async function syncWithInacash(refId: string, subMerchantId: string) {
  try {
    // 1) Get sub-merchant credentials
    const sub = await prisma.sub_merchant.findUnique({
      where: { id: subMerchantId },
      select: { credentials: true }
    });
    if (!sub) throw new Error('Sub-merchant not found');

    const raw = sub.credentials as unknown as {
      baseUrl?: string;
      email: string;
      password: string;
      productCode?: string;
      callbackUrl?: string;
      permanentToken?: string;
      merchantId?: string;
      apiVersion?: string;
    };

    const cfg: Ing1Config = {
      baseUrl: raw.baseUrl || 'https://api.ing1.com',
      email: raw.email,
      password: raw.password,
      productCode: raw.productCode,
      callbackUrl: raw.callbackUrl,
      permanentToken: raw.permanentToken,
      merchantId: raw.merchantId,
      apiVersion: raw.apiVersion
    };

    const client = new Ing1Client(cfg);

    // 2) Check transaction status with Inacash
    const checkResult = await client.checkCashin({ reff: refId });

    // 3) Map INA response to order settlement data
    let settlementStatus = 'PENDING';
    let settlementAmount: number | undefined;
    let rrn: string | undefined;
    let settlementTime: Date | undefined;

    if (checkResult.status === 'PAID' && checkResult.rc === 0) {
      settlementStatus = 'COMPLETED';
      settlementAmount = checkResult.data?.amount || 0;
      rrn = checkResult.reff || 'N/A';
      // INA doesn't always provide paid_at in check response, use now
      settlementTime = new Date();
    } else if (checkResult.status === 'PENDING' && checkResult.rc === 91) {
      settlementStatus = 'PENDING';
    } else {
      settlementStatus = 'FAILED';
    }

    // 4) Update order in database
    return prisma.order.update({
      where: { id: refId },
      data: {
        status: settlementStatus === 'COMPLETED' ? 'SETTLED' : 'PAID',
        settlementAmount: settlementAmount ?? undefined,
        settlementAt: settlementStatus === 'COMPLETED' ? settlementTime : undefined,
        settlementStatus: settlementStatus,
        updatedAt: new Date()
      }
    });
  } catch (err) {
    logger.error(`[InacashSettlement] syncWithInacash failed for ${refId}:`, err);
    throw err;
  }
}

/**
 * Get settlement result from Inacash for a given order
 * Used by the settlement cron job to fetch settlement details
 */
export async function getInacashSettlementResult(
  orderId: string,
  subMerchantId: string,
  credentials: any
): Promise<{ netAmt: number; rrn: string; st: string; tmt?: Date; fee?: number } | null> {
  try {
    const cfg: Ing1Config = {
      baseUrl: credentials.baseUrl || 'https://api.ing1.com',
      email: credentials.email,
      password: credentials.password,
      productCode: credentials.productCode,
      callbackUrl: credentials.callbackUrl,
      permanentToken: credentials.permanentToken,
      merchantId: credentials.merchantId,
      apiVersion: credentials.apiVersion
    };

    const client = new Ing1Client(cfg);

    // Check transaction status
    const checkResult = await client.checkCashin({ reff: orderId });

    // If not paid or failed, return null (not ready for settlement)
    if (checkResult.rc !== 0 || checkResult.status !== 'PAID') {
      return null;
    }

    // Extract settlement details
    const netAmount = checkResult.data?.amount || 0;
    const rrn = checkResult.reff || 'N/A';
    const settlementTime = checkResult.data?.paid_at ? new Date(checkResult.data.paid_at) : new Date();

    return {
      netAmt: netAmount,
      rrn: rrn,
      st: 'COMPLETED', // Inacash completed settlement status
      tmt: settlementTime,
      fee: checkResult.data?.fee || undefined
    };
  } catch (err) {
    logger.error(`[InacashSettlement] getInacashSettlementResult failed for order ${orderId}:`, err);
    return null;
  }
}

/**
 * Fetch bank codes supported by Inacash for withdrawals
 */
export async function fetchBankCodes(merchantId: string) {
  try {
    const providers = await getActiveProviders(merchantId, 'ing1');
    if (!providers.length) throw new Error('No active Inacash/ING1 credentials');

    const credentials = providers[0].credentials as any;
    const cfg: Ing1Config = {
      baseUrl: credentials.baseUrl || 'https://api.ing1.com',
      email: credentials.email,
      password: credentials.password,
      productCode: credentials.productCode,
      callbackUrl: credentials.callbackUrl,
      permanentToken: credentials.permanentToken,
      merchantId: credentials.merchantId,
      apiVersion: credentials.apiVersion
    };

    const client = new Ing1Client(cfg);
    return await client.getBankCodes();
  } catch (err) {
    logger.error('[InacashSettlement] fetchBankCodes failed:', err);
    throw err;
  }
}

/**
 * Validate bank account details via Inacash
 */
export async function inquiryAccount(
  merchantId: string,
  accountNumber: string,
  bankCode: string
) {
  try {
    const providers = await getActiveProviders(merchantId, 'ing1');
    if (!providers.length) throw new Error('No active Inacash/ING1 credentials');

    const credentials = providers[0].credentials as any;
    const cfg: Ing1Config = {
      baseUrl: credentials.baseUrl || 'https://api.ing1.com',
      email: credentials.email,
      password: credentials.password,
      productCode: credentials.productCode,
      callbackUrl: credentials.callbackUrl,
      permanentToken: credentials.permanentToken,
      merchantId: credentials.merchantId,
      apiVersion: credentials.apiVersion
    };

    const client = new Ing1Client(cfg);

    // Use cashout inquiry to validate account
    const result = await client.cashoutInquiry({
      bankCode,
      accountNumber,
      amount: 1000, // dummy amount for inquiry
      clientReff: `inquiry_${Date.now()}`
    });

    return {
      accountName: result.accountName,
      accountNumber: result.accountNumber,
      bankCode: result.bankCode,
      bankName: result.bankName,
      status: result.rc === 0 ? 'VALID' : 'INVALID',
      fee: result.fee
    };
  } catch (err) {
    logger.error('[InacashSettlement] inquiryAccount failed:', err);
    throw err;
  }
}
