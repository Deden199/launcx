import { prisma } from '../core/prisma';
import logger from '../logger';
import { Ing1Client, Ing1Config } from './ing1Client';
import { parseIng1Date, parseIng1Number } from './ing1Status';
import moment from 'moment-timezone';
import { DisbursementStatus } from '@prisma/client';

const FINAL_STATUSES = ['PAID', 'FAILED', 'COMPLETED', 'SUCCESS'];

export function evaluateFinalWithdrawalStatus(resp: any): string | null {
  const status = resp?.status ?? null;
  return FINAL_STATUSES.includes((status || '').toUpperCase())
    ? (status || '').toUpperCase()
    : null;
}

interface WithdrawalFallbackOptions {
  reff?: string | null;
  clientReff?: string | null;
}

const mapIng1ToDisbursement = (
  rc?: number | null,
  statusText?: string | null
): DisbursementStatus => {
  if (rc === 0) return DisbursementStatus.COMPLETED;
  if (rc === 91) return DisbursementStatus.PENDING;

  const normalized = (statusText || '').toUpperCase();
  if (['PAID', 'SUCCESS', 'COMPLETED'].includes(normalized)) {
    return DisbursementStatus.COMPLETED;
  }
  if (['PENDING', 'PROCESS', 'PROCESSING'].includes(normalized)) {
    return DisbursementStatus.PENDING;
  }
  return DisbursementStatus.FAILED;
};

async function resendWithdrawalCallback(
  refId: string,
  cfg: Ing1Config,
  opts: WithdrawalFallbackOptions
) {
  try {
    logger.info(`[ing1WithdrawalFallback] resend callback for ${refId}`);
    const client = new Ing1Client(cfg);

    const withdrawal = await prisma.withdrawRequest.findUnique({
      where: { refId },
      select: {
        paymentGatewayId: true,
        refId: true,
        partnerClientId: true,
        amount: true,
        status: true
      },
    });

    if (!withdrawal) {
      logger.error(`[ing1WithdrawalFallback] Withdrawal not found: ${refId}`);
      return;
    }

    const reff = opts.reff ?? withdrawal.paymentGatewayId ?? undefined;
    const clientReff = opts.clientReff ?? refId;

    if (!reff) {
      logger.error(`[ing1WithdrawalFallback] No reff found for withdrawal: ${refId}`);
      return;
    }

    const resp = await client.checkCashout({ reff, clientReff });
    const data = resp.data ?? {};

    const newStatus = mapIng1ToDisbursement(resp.rc, (data.status as string) ?? resp.status);

    const updateData: any = {
      status: newStatus,
    };

    if (resp.reff) {
      updateData.paymentGatewayId = resp.reff;
    }

    const feeRaw = parseIng1Number(
      data.fee ?? data.total_fee ?? data.admin_fee?.total_fee ?? null
    );
    if (feeRaw != null) {
      updateData.pgFee = feeRaw;
    }

    const completedAt = parseIng1Date(
      data.completed_at ?? data.settlement_time ?? data.paid_at ?? null
    );
    if (completedAt) {
      updateData.completedAt = completedAt;
    }

    await prisma.withdrawRequest.update({
      where: { refId },
      data: updateData,
    });

    // Handle balance adjustments
    if (withdrawal.status !== newStatus) {
      if (withdrawal.status === DisbursementStatus.PENDING && newStatus === DisbursementStatus.FAILED) {
        await prisma.partnerClient.update({
          where: { id: withdrawal.partnerClientId },
          data: { balance: { increment: withdrawal.amount } },
        });
      } else if (
        withdrawal.status === DisbursementStatus.FAILED &&
        newStatus === DisbursementStatus.COMPLETED
      ) {
        await prisma.partnerClient.update({
          where: { id: withdrawal.partnerClientId },
          data: { balance: { decrement: withdrawal.amount } },
        });
      }
    }

    logger.info(`[ing1WithdrawalFallback] resend processed for ${refId}, status: ${newStatus}`);
  } catch (err: any) {
    logger.error(`[ing1WithdrawalFallback] resend error for ${refId}: ${err.message}`);
  }
}

export async function scheduleIng1WithdrawalFallback(
  refId: string,
  cfg: Ing1Config,
  opts: WithdrawalFallbackOptions = {}
) {
  const delayMs = 3 * 60 * 1000;
  const nextRetry = moment().tz('Asia/Jakarta').add(delayMs, 'ms').toDate();

  try {
    await prisma.ing1WithdrawalWatcher.upsert({
      where: { refId },
      update: { attemptCount: 0, processed: false, nextRetryAt: nextRetry },
      create: { refId, attemptCount: 0, processed: false, nextRetryAt: nextRetry },
    });
  } catch (err: any) {
    logger.error(`[ing1WithdrawalFallback] failed to register watcher for ${refId}: ${err.message}`);
    return;
  }

  const checkAndResend = async () => {
    try {
      const watcher = await prisma.ing1WithdrawalWatcher.findUnique({
        where: { refId },
      });
      if (!watcher || watcher.processed) return;

      const withdrawal = await prisma.withdrawRequest.findUnique({
        where: { refId },
        select: {
          status: true,
          paymentGatewayId: true,
          refId: true,
        },
      });

      if (!withdrawal) {
        await prisma.ing1WithdrawalWatcher.update({
          where: { refId },
          data: { processed: true },
        });
        return;
      }

      // If already in final state, mark as processed
      const finalStatuses: DisbursementStatus[] = [DisbursementStatus.COMPLETED, DisbursementStatus.FAILED];
      if (finalStatuses.includes(withdrawal.status)) {
        await prisma.ing1WithdrawalWatcher.update({
          where: { refId },
          data: { processed: true },
        });
        return;
      }

      const reff = opts.reff ?? withdrawal.paymentGatewayId ?? undefined;
      const clientReff = opts.clientReff ?? refId;

      if (!reff) {
        await prisma.ing1WithdrawalWatcher.update({
          where: { refId },
          data: { processed: true },
        });
        return;
      }

      logger.info(`[ing1WithdrawalFallback] fetching status for ${refId}`);
      const client = new Ing1Client(cfg);
      const resp = await client.checkCashout({ reff, clientReff });
      const status = evaluateFinalWithdrawalStatus(resp);

      if (status) {
        await resendWithdrawalCallback(refId, cfg, opts);
        await prisma.ing1WithdrawalWatcher.update({
          where: { refId },
          data: { processed: true, attemptCount: watcher.attemptCount + 1 },
        });
        return;
      }

      const attempts = watcher.attemptCount + 1;
      const backoffs = [10, 40];
      if (attempts >= 3) {
        await prisma.ing1WithdrawalWatcher.update({
          where: { refId },
          data: { attemptCount: attempts },
        });
        return;
      }

      const nextDelay = backoffs[attempts - 1] * 60 * 1000;
      const nextTime = moment().tz('Asia/Jakarta').add(nextDelay, 'ms').toDate();
      await prisma.ing1WithdrawalWatcher.update({
        where: { refId },
        data: { attemptCount: attempts, nextRetryAt: nextTime },
      });
      setTimeout(checkAndResend, nextDelay);
    } catch (err: any) {
      logger.error(`[ing1WithdrawalFallback] error for ${refId}: ${err.message}`);
    }
  };

  setTimeout(checkAndResend, delayMs);
}
