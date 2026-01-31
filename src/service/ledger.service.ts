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
  const withdrawal = await prisma.withdrawRequest.findUnique({
    where: { id: withdrawalId },
    select: {
      id: true,
      refId: true,
      status: true,
      amount: true,
      partnerClientId: true,
    },
  });

  if (!withdrawal) {
    // Try finding by refId
    const byRefId = await prisma.withdrawRequest.findFirst({
      where: { refId: withdrawalId },
      select: {
        id: true,
        refId: true,
        status: true,
        amount: true,
        partnerClientId: true,
      },
    });
    
    if (!byRefId) {
      logger.warn('[Ledger] Withdrawal not found for callback', { withdrawalId });
      return { processed: false, reason: 'WITHDRAWAL_NOT_FOUND' };
    }
  }

  const wd = withdrawal!;
  const newStatus = mapDisbursementStatus(statusCode);

  // Check if already in final state
  if (['COMPLETED', 'FAILED'].includes(wd.status)) {
    logger.info('[Ledger] Withdrawal already in final state', {
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
    oldStatus: wd.status,
    newStatus,
    statusCode,
  });

  return { processed: true, newStatus };
}

/**
 * Process withdrawal balance deduction
 * Called ONLY for COMPLETED withdrawals that haven't had balance deducted
 * 
 * This is the ledger logic that ensures balance is only deducted
 * after DanaRapay confirms SUCCESS
 */
export async function processWithdrawalBalanceDeduction(withdrawalId: string): Promise<{
  processed: boolean;
  reason?: string;
  balanceChange?: number;
}> {
  const withdrawal = await prisma.withdrawRequest.findUnique({
    where: { id: withdrawalId },
    select: {
      id: true,
      status: true,
      amount: true,
      netAmount: true,
      partnerClientId: true,
      balanceDeducted: true,
    },
  });

  if (!withdrawal) {
    return { processed: false, reason: 'NOT_FOUND' };
  }

  // Only process COMPLETED withdrawals
  if (withdrawal.status !== 'COMPLETED') {
    return { processed: false, reason: 'NOT_COMPLETED' };
  }

  // Check if balance already deducted
  if (withdrawal.balanceDeducted) {
    return { processed: false, reason: 'ALREADY_DEDUCTED' };
  }

  const deductAmount = withdrawal.amount;

  // Deduct balance and mark as processed
  await prisma.$transaction(async (tx) => {
    await tx.withdrawRequest.update({
      where: { id: withdrawalId },
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

    logger.info('[Ledger] Withdrawal balance deducted', {
      withdrawalId,
      partnerClientId: withdrawal.partnerClientId,
      deductAmount,
    });
  });

  return { processed: true, balanceChange: -deductAmount };
}

/**
 * Refund withdrawal balance (for FAILED withdrawals that had balance pre-deducted)
 * This handles backward compatibility with old flow
 */
export async function refundFailedWithdrawal(withdrawalId: string): Promise<{
  processed: boolean;
  reason?: string;
}> {
  const withdrawal = await prisma.withdrawRequest.findUnique({
    where: { id: withdrawalId },
    select: {
      id: true,
      status: true,
      amount: true,
      partnerClientId: true,
      balanceRefunded: true,
    },
  });

  if (!withdrawal) {
    return { processed: false, reason: 'NOT_FOUND' };
  }

  if (withdrawal.status !== 'FAILED') {
    return { processed: false, reason: 'NOT_FAILED' };
  }

  if (withdrawal.balanceRefunded) {
    return { processed: false, reason: 'ALREADY_REFUNDED' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.withdrawRequest.update({
      where: { id: withdrawalId },
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
      withdrawalId,
      partnerClientId: withdrawal.partnerClientId,
      refundAmount: withdrawal.amount,
    });
  });

  return { processed: true };
}
