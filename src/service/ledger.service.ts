// src/service/ledger.service.ts
// Ledger Service - DanaRapay as Source of Truth
//
// Saldo client HANYA berubah berdasarkan status transaksi yang sudah SETTLED,
// BUKAN dari callback langsung. Ini menjaga konsistensi ledger.

import { prisma } from '../core/prisma';
import logger from '../logger';

/**
 * DanaRapay Settlement Status Constants
 */
export const SETTLEMENT_STATUS = {
  WAITING: 'WAITING',
  SUCCESS: 'SUCCESS',
} as const;

/**
 * Process settlement for an order
 * Called by ledger reconciliation logic, NOT directly from callback
 * 
 * @param orderId - Order ID to process
 * @returns true if balance was updated, false if already processed or invalid
 */
export async function processOrderSettlement(orderId: string): Promise<{
  processed: boolean;
  reason?: string;
  balanceChange?: number;
}> {
  const order = await prisma.order.findUnique({
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

  // Only process if status is SETTLED and not yet processed
  if (order.status !== 'SETTLED') {
    return { processed: false, reason: 'NOT_SETTLED' };
  }

  // Check if already processed to prevent double credit
  if (order.ledgerProcessed) {
    logger.info('[Ledger] Order already processed', { orderId });
    return { processed: false, reason: 'ALREADY_PROCESSED' };
  }

  // Calculate settlement amount
  const settlementAmount = order.settlementAmount ?? order.pendingAmount ?? order.amount;

  if (!order.partnerClientId) {
    return { processed: false, reason: 'NO_PARTNER_CLIENT' };
  }

  // Update balance and mark as processed in a transaction
  await prisma.$transaction(async (tx) => {
    // Mark order as ledger processed
    await tx.order.update({
      where: { id: orderId },
      data: { 
        ledgerProcessed: true,
        ledgerProcessedAt: new Date(),
      },
    });

    // Credit client balance
    await tx.partnerClient.update({
      where: { id: order.partnerClientId! },
      data: {
        balance: { increment: settlementAmount },
      },
    });

    logger.info('[Ledger] Settlement processed - balance credited', {
      orderId,
      partnerClientId: order.partnerClientId,
      settlementAmount,
      channel: order.channel,
    });
  });

  return { 
    processed: true, 
    balanceChange: settlementAmount 
  };
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

/**
 * DanaRapay Disbursement Status Constants (Source of Truth)
 */
export const DISBURSEMENT_STATUS = {
  IN_PROGRESS: '101',
  PENDING: '301',
  SUCCESS: '000',
  FAILED: '300',
} as const;

/**
 * Map DanaRapay disbursement status code to internal status
 */
export function mapDisbursementStatus(statusCode: string): 'PENDING' | 'COMPLETED' | 'FAILED' | 'PROCESSING' {
  switch (statusCode) {
    case DISBURSEMENT_STATUS.SUCCESS:
      return 'COMPLETED';
    case DISBURSEMENT_STATUS.FAILED:
      return 'FAILED';
    case DISBURSEMENT_STATUS.IN_PROGRESS:
      return 'PROCESSING';
    case DISBURSEMENT_STATUS.PENDING:
      return 'PENDING';
    default:
      // Unknown status - keep as pending
      return 'PENDING';
  }
}

/**
 * Process withdrawal settlement based on DanaRapay callback
 * 
 * IMPORTANT: This only updates withdrawal status.
 * Balance adjustment happens in a separate ledger logic.
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
  newStatus?: string;
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

  // Check if already in final state - idempotency
  if (['COMPLETED', 'FAILED'].includes(wd.status)) {
    logger.info('[Ledger] Withdrawal already in final state (idempotent)', {
      withdrawalId: wd.id,
      currentStatus: wd.status,
      incomingStatus: newStatus,
    });
    return { processed: false, reason: 'ALREADY_FINAL', newStatus: wd.status };
  }

  // Update withdrawal status only - NO balance change here
  await prisma.withdrawRequest.update({
    where: { id: wd.id },
    data: {
      status: newStatus as any,
      disbursementPayload: rawPayload,
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
    balanceDeducted: wd.balanceDeducted,
  });

  return { processed: true, newStatus };
}

/**
 * Process withdrawal balance deduction
 * Called ONLY for COMPLETED withdrawals that haven't had balance deducted
 * 
 * This is the ledger logic that ensures balance is only deducted
 * after DanaRapay confirms SUCCESS
 * 
 * IDEMPOTENT: Will not deduct if balanceDeducted=true
 * This handles backward compatibility with legacy providers that deducted on create
 */
export async function processWithdrawalBalanceDeduction(withdrawalId: string): Promise<{
  processed: boolean;
  reason?: string;
  balanceChange?: number;
}> {
  // Try finding by id first, then by refId
  let withdrawal = await prisma.withdrawRequest.findUnique({
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
    withdrawal = await prisma.withdrawRequest.findFirst({
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

  // CRITICAL: Check if balance already deducted - prevents double debit
  // This handles:
  // 1. Duplicate callbacks
  // 2. Legacy providers that deducted balance on create (balanceDeducted=true from create)
  if (withdrawal.balanceDeducted) {
    logger.info('[Ledger] Balance already deducted (idempotent guard)', {
      withdrawalId: withdrawal.id,
      refId: withdrawal.refId,
    });
    return { processed: false, reason: 'ALREADY_DEDUCTED' };
  }

  const deductAmount = withdrawal.amount;

  // Deduct balance and mark as processed - atomic transaction
  await prisma.$transaction(async (tx) => {
    await tx.withdrawRequest.update({
      where: { id: withdrawal!.id },
      data: { 
        balanceDeducted: true,
        balanceDeductedAt: new Date(),
      },
    });

    await tx.partnerClient.update({
      where: { id: withdrawal!.partnerClientId },
      data: {
        balance: { decrement: deductAmount },
      },
    });

    logger.info('[Ledger] Withdrawal balance deducted', {
      withdrawalId: withdrawal!.id,
      refId: withdrawal!.refId,
      partnerClientId: withdrawal!.partnerClientId,
      deductAmount,
    });
  });

  return { processed: true, balanceChange: -deductAmount };
}

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
  // Try finding by id first, then by refId
  let withdrawal = await prisma.withdrawRequest.findUnique({
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
    withdrawal = await prisma.withdrawRequest.findFirst({
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

  await prisma.$transaction(async (tx) => {
    await tx.withdrawRequest.update({
      where: { id: withdrawal!.id },
      data: { 
        balanceRefunded: true,
        balanceRefundedAt: new Date(),
      },
    });

    await tx.partnerClient.update({
      where: { id: withdrawal!.partnerClientId },
      data: {
        balance: { increment: withdrawal!.amount },
      },
    });

    logger.info('[Ledger] Failed withdrawal refunded', {
      withdrawalId: withdrawal!.id,
      refId: withdrawal!.refId,
      partnerClientId: withdrawal!.partnerClientId,
      refundAmount: withdrawal!.amount,
    });
  });

  return { processed: true };
}
