// src/service/ledger.service.ts
// Ledger Service - DanaRapay as Source of Truth
//
// Saldo client HANYA berubah berdasarkan status transaksi yang sudah SETTLED,
// BUKAN dari callback langsung. Ini menjaga konsistensi ledger.

import { prisma } from '../core/prisma';
import logger from '../logger';

// =====================================================
// PROVIDER CONSTANTS - Single source of truth
// =====================================================

/**
 * Payment Provider identifiers - MUST use these constants everywhere
 * Do NOT use raw strings to avoid case mismatch issues
 */
export const PROVIDERS = {
  DANARAPAY: 'danarapay',
  HILOGATE: 'hilogate',
  OY: 'oy',
  PIRO: 'piro',
  GIDI: 'gidi',
  ING1: 'ing1',
  GENESIS: 'genesis',
} as const;

export type ProviderType = typeof PROVIDERS[keyof typeof PROVIDERS];

/**
 * Check if provider is DanaRapay (case-insensitive safe)
 */
export function isDanarapayProvider(provider: string | null | undefined): boolean {
  return provider?.toLowerCase() === PROVIDERS.DANARAPAY;
}

/**
 * Check if provider uses callback-based balance deduction
 * DanaRapay: balance deducted via ledger after callback SUCCESS
 * Legacy providers: balance deducted on create (hold)
 */
export function isCallbackBasedProvider(provider: string | null | undefined): boolean {
  return isDanarapayProvider(provider);
}

// =====================================================
// SETTLEMENT STATUS CONSTANTS
// =====================================================

/**
 * DanaRapay Settlement Status Constants (VA Callback)
 */
export const SETTLEMENT_STATUS = {
  WAITING: 'WAITING',
  SUCCESS: 'SUCCESS',
} as const;

// =====================================================
// DISBURSEMENT STATUS MAPPING - Complete mapping
// =====================================================

/**
 * DanaRapay Disbursement Status Codes (Source of Truth)
 * Reference: DanaRapay API v1.2.4
 */
export const DISBURSEMENT_CODES = {
  // SUCCESS - Final, triggers balance deduction
  SUCCESS: '000',
  
  // IN PROGRESS - Non-final, keep polling
  IN_PROGRESS: '101',
  IN_PROGRESS_VALIDATION: '102',
  
  // PENDING - Non-final, waiting for bank processing
  PENDING: '301',
  PENDING_CUTOFF: '504',
  
  // FAILED - Final, no retry
  FAILED: '300',
  FAILED_VALIDATION: '302',
  FAILED_BANK_REJECT: '303',
  FAILED_INSUFFICIENT: '304',
  FAILED_TIMEOUT: '305',
  
  // UNKNOWN/SYSTEM ERROR - Treat as pending, need manual check
  SYSTEM_ERROR: '999',
  UNKNOWN: '500',
} as const;

/**
 * Internal withdrawal status
 */
export type WithdrawalStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

/**
 * Map DanaRapay disbursement status code to internal status
 * 
 * IMPORTANT: Only truly final codes should map to COMPLETED or FAILED
 * All intermediate/unknown codes should stay PENDING or PROCESSING
 */
export function mapDisbursementStatus(statusCode: string): WithdrawalStatus {
  switch (statusCode) {
    // SUCCESS - Final, balance can be deducted
    case DISBURSEMENT_CODES.SUCCESS:
      return 'COMPLETED';
    
    // IN PROGRESS - Still processing
    case DISBURSEMENT_CODES.IN_PROGRESS:
    case DISBURSEMENT_CODES.IN_PROGRESS_VALIDATION:
      return 'PROCESSING';
    
    // PENDING - Waiting for bank/cutoff
    case DISBURSEMENT_CODES.PENDING:
    case DISBURSEMENT_CODES.PENDING_CUTOFF:
      return 'PENDING';
    
    // FAILED - Final failure states only
    case DISBURSEMENT_CODES.FAILED:
    case DISBURSEMENT_CODES.FAILED_VALIDATION:
    case DISBURSEMENT_CODES.FAILED_BANK_REJECT:
    case DISBURSEMENT_CODES.FAILED_INSUFFICIENT:
    case DISBURSEMENT_CODES.FAILED_TIMEOUT:
      return 'FAILED';
    
    // UNKNOWN/SYSTEM ERROR - Keep as pending, need manual intervention
    case DISBURSEMENT_CODES.SYSTEM_ERROR:
    case DISBURSEMENT_CODES.UNKNOWN:
    default:
      // Unknown codes stay as PENDING - don't assume failure
      logger.warn('[Ledger] Unknown disbursement status code, treating as PENDING', {
        statusCode,
      });
      return 'PENDING';
  }
}

/**
 * Check if disbursement status is final (no more callbacks expected)
 */
export function isDisbursementFinal(statusCode: string): boolean {
  return statusCode === DISBURSEMENT_CODES.SUCCESS ||
         statusCode === DISBURSEMENT_CODES.FAILED ||
         statusCode === DISBURSEMENT_CODES.FAILED_VALIDATION ||
         statusCode === DISBURSEMENT_CODES.FAILED_BANK_REJECT ||
         statusCode === DISBURSEMENT_CODES.FAILED_INSUFFICIENT ||
         statusCode === DISBURSEMENT_CODES.FAILED_TIMEOUT;
}

// =====================================================
// ORDER SETTLEMENT PROCESSING - ATOMIC & IDEMPOTENT
// =====================================================

/**
 * Process settlement for an order (VA/QRIS payment credit)
 * Called by ledger reconciliation logic, NOT directly from callback
 * 
 * ATOMIC & IDEMPOTENT:
 * - Guard check (ledgerProcessed) INSIDE transaction
 * - Credit + set flag in ONE atomic transaction
 * - Parallel callbacks cannot double credit
 * 
 * @param orderId - Order ID to process
 * @returns true if balance was updated, false if already processed or invalid
 */
export async function processOrderSettlement(orderId: string): Promise<{
  processed: boolean;
  reason?: string;
  balanceChange?: number;
}> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // CRITICAL: Read INSIDE transaction for atomicity
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          partnerClientId: true,
          status: true,
          settlementStatus: true,
          settlementAmount: true,
          pendingAmount: true,
          amount: true,
          ledgerProcessed: true,
          channel: true,
        },
      });

      if (!order) {
        return { processed: false, reason: 'ORDER_NOT_FOUND' };
      }

      // Only process if status is SETTLED
      if (order.status !== 'SETTLED') {
        return { processed: false, reason: 'NOT_SETTLED' };
      }

      // CRITICAL GUARD: Check inside transaction to prevent double credit
      // This handles parallel callback race conditions
      if (order.ledgerProcessed === true) {
        logger.info('[Ledger] Order already processed (idempotent guard)', { orderId });
        return { processed: false, reason: 'ALREADY_PROCESSED' };
      }

      if (!order.partnerClientId) {
        return { processed: false, reason: 'NO_PARTNER_CLIENT' };
      }

      // Calculate settlement amount
      const settlementAmount = order.settlementAmount ?? order.pendingAmount ?? order.amount;

      // ATOMIC: Mark as processed + credit balance in ONE transaction
      await tx.order.update({
        where: { id: orderId },
        data: { 
          ledgerProcessed: true,
          ledgerProcessedAt: new Date(),
        },
      });

      await tx.partnerClient.update({
        where: { id: order.partnerClientId },
        data: {
          balance: { increment: settlementAmount },
        },
      });

      logger.info('[Ledger] Settlement processed - balance credited (atomic)', {
        orderId,
        partnerClientId: order.partnerClientId,
        settlementAmount,
        channel: order.channel,
      });

      return { 
        processed: true, 
        balanceChange: settlementAmount 
      };
    });

    return result;
  } catch (err: any) {
    logger.error('[Ledger] Settlement transaction failed', {
      orderId,
      error: err.message,
    });
    return { processed: false, reason: `TRANSACTION_ERROR: ${err.message}` };
  }
}

/**
 * Process pending settlements
 * This can be called by a cron job or after callback updates status
 * 
 * Finds all orders with status=SETTLED but ledgerProcessed=false
 */
export async function processPendingSettlements(): Promise<{
  processed: number;
  failed: number;
  errors: string[];
}> {
  const pendingOrders = await prisma.order.findMany({
    where: {
      status: 'SETTLED',
      ledgerProcessed: { not: true },
      partnerClientId: { not: null },
    },
    select: { id: true },
    take: 100, // Process in batches
  });

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const order of pendingOrders) {
    try {
      const result = await processOrderSettlement(order.id);
      if (result.processed) {
        processed++;
      }
    } catch (err: any) {
      failed++;
      errors.push(`Order ${order.id}: ${err.message}`);
      logger.error('[Ledger] Failed to process settlement', {
        orderId: order.id,
        error: err.message,
      });
    }
  }

  if (processed > 0 || failed > 0) {
    logger.info('[Ledger] Batch settlement processing complete', {
      processed,
      failed,
      total: pendingOrders.length,
    });
  }

  return { processed, failed, errors };
}

// =====================================================
// WITHDRAWAL CALLBACK PROCESSING
// =====================================================

/**
 * Process withdrawal callback based on DanaRapay disbursement status
 * 
 * IMPORTANT: This only updates withdrawal status + stores audit data.
 * Balance adjustment happens in processWithdrawalBalanceDeduction.
 * 
 * @param withdrawalId - Withdrawal request ID (partner_trx_id in DanaRapay)
 * @param statusCode - DanaRapay status code
 * @param rawPayload - Full callback payload for audit
 */
export async function processWithdrawalCallback(
  withdrawalId: string,
  statusCode: string,
  rawPayload: any
): Promise<{
  processed: boolean;
  reason?: string;
  newStatus?: WithdrawalStatus;
  isFinal?: boolean;
}> {
  // Try finding by id first
  let wd = await prisma.withdrawRequest.findUnique({
    where: { id: withdrawalId },
    select: {
      id: true,
      refId: true,
      status: true,
      amount: true,
      partnerClientId: true,
      balanceDeducted: true,
    },
  });

  // If not found by id, try finding by refId
  if (!wd) {
    wd = await prisma.withdrawRequest.findFirst({
      where: { refId: withdrawalId },
      select: {
        id: true,
        refId: true,
        status: true,
        amount: true,
        partnerClientId: true,
        balanceDeducted: true,
      },
    });
    
    if (!wd) {
      logger.warn('[Ledger] Withdrawal not found for callback', { withdrawalId });
      return { processed: false, reason: 'WITHDRAWAL_NOT_FOUND' };
    }
    
    logger.info('[Ledger] Withdrawal found by refId', { 
      searchId: withdrawalId, 
      foundId: wd.id,
      foundRefId: wd.refId 
    });
  }

  const newStatus = mapDisbursementStatus(statusCode);
  const isFinal = isDisbursementFinal(statusCode);

  // Check if already in final state - idempotency
  if (['COMPLETED', 'FAILED'].includes(wd.status)) {
    logger.info('[Ledger] Withdrawal already in final state (idempotent)', {
      withdrawalId: wd.id,
      currentStatus: wd.status,
      incomingStatus: newStatus,
      incomingCode: statusCode,
    });
    return { processed: false, reason: 'ALREADY_FINAL', newStatus: wd.status as WithdrawalStatus };
  }

  // Extract status description for audit
  const statusDescription = rawPayload?.status?.message || 
                           rawPayload?.tx_status_description || 
                           rawPayload?.message || '';

  // Update withdrawal status only - NO balance change here
  await prisma.withdrawRequest.update({
    where: { id: wd.id },
    data: {
      status: newStatus as any,
      disbursementPayload: {
        ...rawPayload,
        _processedAt: new Date().toISOString(),
        _statusCode: statusCode,
        _statusDescription: statusDescription,
        _isFinal: isFinal,
      },
      updatedAt: new Date(),
      ...(newStatus === 'COMPLETED' ? { completedAt: new Date() } : {}),
    },
  });

  logger.info('[Ledger] Withdrawal status updated from callback', {
    withdrawalId: wd.id,
    refId: wd.refId,
    oldStatus: wd.status,
    newStatus,
    statusCode,
    statusDescription,
    isFinal,
    balanceDeducted: wd.balanceDeducted,
  });

  return { processed: true, newStatus, isFinal };
}

// =====================================================
// WITHDRAWAL BALANCE DEDUCTION - Atomic & Guarded
// =====================================================

/**
 * Process withdrawal balance deduction
 * Called ONLY for COMPLETED withdrawals that haven't had balance deducted
 * 
 * ATOMIC & GUARDED:
 * - Checks balanceDeducted === false INSIDE transaction
 * - Debit + set balanceDeducted=true in ONE atomic transaction
 * - Handles parallel callback race conditions
 * 
 * IDEMPOTENT: Will not deduct if balanceDeducted=true
 * This handles:
 * 1. Duplicate callbacks
 * 2. Legacy providers that deducted balance on create (balanceDeducted=true from create)
 * 3. Parallel callback processing (atomic transaction prevents race)
 */
export async function processWithdrawalBalanceDeduction(withdrawalId: string): Promise<{
  processed: boolean;
  reason?: string;
  balanceChange?: number;
}> {
  // Use transaction to ensure atomicity against parallel callbacks
  try {
    const result = await prisma.$transaction(async (tx) => {
      // CRITICAL: Read inside transaction with row lock
      // Try finding by id first, then by refId
      let withdrawal = await tx.withdrawRequest.findUnique({
        where: { id: withdrawalId },
        select: {
          id: true,
          refId: true,
          status: true,
          amount: true,
          netAmount: true,
          partnerClientId: true,
          balanceDeducted: true,
        },
      });

      if (!withdrawal) {
        withdrawal = await tx.withdrawRequest.findFirst({
          where: { refId: withdrawalId },
          select: {
            id: true,
            refId: true,
            status: true,
            amount: true,
            netAmount: true,
            partnerClientId: true,
            balanceDeducted: true,
          },
        });
      }

      if (!withdrawal) {
        logger.warn('[Ledger] Withdrawal not found for balance deduction', { withdrawalId });
        return { processed: false, reason: 'NOT_FOUND' };
      }

      // Only process COMPLETED withdrawals
      if (withdrawal.status !== 'COMPLETED') {
        logger.info('[Ledger] Withdrawal not completed, skipping balance deduction', {
          withdrawalId: withdrawal.id,
          status: withdrawal.status,
        });
        return { processed: false, reason: 'NOT_COMPLETED' };
      }

      // CRITICAL GUARD: Check if balance already deducted
      // This MUST be checked inside transaction to handle parallel callbacks
      if (withdrawal.balanceDeducted === true) {
        logger.info('[Ledger] Balance already deducted (idempotent guard)', {
          withdrawalId: withdrawal.id,
          refId: withdrawal.refId,
        });
        return { processed: false, reason: 'ALREADY_DEDUCTED' };
      }

      const deductAmount = withdrawal.amount;

      // GATE 2: NEGATIVE BALANCE GUARD
      // Check client balance INSIDE transaction to prevent race conditions
      const partnerClient = await tx.partnerClient.findUnique({
        where: { id: withdrawal.partnerClientId },
        select: { id: true, balance: true, name: true },
      });

      if (!partnerClient) {
        logger.error('[Ledger] PartnerClient not found for withdrawal', {
          withdrawalId: withdrawal.id,
          partnerClientId: withdrawal.partnerClientId,
        });
        return { processed: false, reason: 'PARTNER_CLIENT_NOT_FOUND' };
      }

      // CRITICAL: Ensure sufficient balance before deduction
      if (partnerClient.balance < deductAmount) {
        logger.error('[Ledger] NEGATIVE BALANCE GUARD: Insufficient balance for withdrawal', {
          withdrawalId: withdrawal.id,
          refId: withdrawal.refId,
          partnerClientId: withdrawal.partnerClientId,
          clientName: partnerClient.name,
          currentBalance: partnerClient.balance,
          deductAmount,
          shortfall: deductAmount - partnerClient.balance,
        });
        return { processed: false, reason: 'INSUFFICIENT_BALANCE' };
      }

      // ATOMIC: Update flag + deduct balance in same transaction
      // This prevents double debit from parallel callbacks
      await tx.withdrawRequest.update({
        where: { id: withdrawal.id },
        data: { 
          balanceDeducted: true,
          balanceDeductedAt: new Date(),
        },
      });

      await tx.partnerClient.update({
        where: { id: withdrawal.partnerClientId },
        data: {
          balance: { decrement: deductAmount },
        },
      });

      logger.info('[Ledger] Withdrawal balance deducted (atomic)', {
        withdrawalId: withdrawal.id,
        refId: withdrawal.refId,
        partnerClientId: withdrawal.partnerClientId,
        deductAmount,
      });

      return { processed: true, balanceChange: -deductAmount };
    });

    return result;
  } catch (err: any) {
    logger.error('[Ledger] Balance deduction transaction failed', {
      withdrawalId,
      error: err.message,
    });
    return { processed: false, reason: `TRANSACTION_ERROR: ${err.message}` };
  }
}

// =====================================================
// WITHDRAWAL REFUND - For failed withdrawals
// =====================================================

/**
 * Refund withdrawal balance (for FAILED withdrawals that had balance pre-deducted)
 * This handles backward compatibility with legacy providers that deducted on create
 * 
 * IMPORTANT: Only refund if balanceDeducted=true (was actually deducted)
 * DanaRapay withdrawals have balanceDeducted=false so won't be refunded (correct behavior)
 */
export async function refundFailedWithdrawal(withdrawalId: string): Promise<{
  processed: boolean;
  reason?: string;
}> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Try finding by id first, then by refId
      let withdrawal = await tx.withdrawRequest.findUnique({
        where: { id: withdrawalId },
        select: {
          id: true,
          refId: true,
          status: true,
          amount: true,
          partnerClientId: true,
          balanceDeducted: true,
          balanceRefunded: true,
        },
      });

      if (!withdrawal) {
        withdrawal = await tx.withdrawRequest.findFirst({
          where: { refId: withdrawalId },
          select: {
            id: true,
            refId: true,
            status: true,
            amount: true,
            partnerClientId: true,
            balanceDeducted: true,
            balanceRefunded: true,
          },
        });
      }

      if (!withdrawal) {
        logger.warn('[Ledger] Withdrawal not found for refund', { withdrawalId });
        return { processed: false, reason: 'NOT_FOUND' };
      }

      if (withdrawal.status !== 'FAILED') {
        return { processed: false, reason: 'NOT_FAILED' };
      }

      // CRITICAL: Only refund if balance was actually deducted
      // DanaRapay withdrawals have balanceDeducted=false, so nothing to refund
      if (!withdrawal.balanceDeducted) {
        logger.info('[Ledger] No balance to refund (balanceDeducted=false)', {
          withdrawalId: withdrawal.id,
          refId: withdrawal.refId,
        });
        return { processed: false, reason: 'BALANCE_NOT_DEDUCTED' };
      }

      if (withdrawal.balanceRefunded) {
        logger.info('[Ledger] Balance already refunded (idempotent)', {
          withdrawalId: withdrawal.id,
        });
        return { processed: false, reason: 'ALREADY_REFUNDED' };
      }

      // ATOMIC: Refund balance and mark as refunded
      await tx.withdrawRequest.update({
        where: { id: withdrawal.id },
        data: { 
          balanceRefunded: true,
          balanceRefundedAt: new Date(),
        },
      });

      await tx.partnerClient.update({
        where: { id: withdrawal.partnerClientId },
        data: {
          balance: { increment: withdrawal.amount },
        },
      });

      logger.info('[Ledger] Failed withdrawal refunded', {
        withdrawalId: withdrawal.id,
        refId: withdrawal.refId,
        partnerClientId: withdrawal.partnerClientId,
        refundAmount: withdrawal.amount,
      });

      return { processed: true };
    });

    return result;
  } catch (err: any) {
    logger.error('[Ledger] Refund transaction failed', {
      withdrawalId,
      error: err.message,
    });
    return { processed: false, reason: `TRANSACTION_ERROR: ${err.message}` };
  }
}
