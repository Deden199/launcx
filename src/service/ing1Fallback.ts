import { prisma } from '../core/prisma';
import logger from '../logger';
import { Ing1Client, Ing1Config } from './ing1Client';
import { parseIng1Date, parseIng1Number, processIng1Update } from './ing1Status';
import moment from 'moment-timezone';

const FINAL_STATUSES = ['PAID', 'FAILED'];

export function evaluateFinalStatus(resp: any): string | null {
  const status = resp?.status ?? null;
  return FINAL_STATUSES.includes((status || '').toUpperCase())
    ? (status || '').toUpperCase()
    : null;
}

export async function cancelIng1Fallback(orderId: string) {
  try {
    await prisma.ing1CallbackWatcher.updateMany({
      where: { orderId },
      data: { processed: true },
    });
  } catch (err: any) {
    logger.error(`[ing1Fallback] failed to cancel fallback for ${orderId}: ${err.message}`);
  }
}

interface FallbackOptions {
  reff?: string | null;
  clientReff?: string | null;
}

async function resendCallback(orderId: string, cfg: Ing1Config, opts: FallbackOptions) {
  try {
    logger.info(`[ing1Fallback] resend callback for ${orderId}`);
    const client = new Ing1Client(cfg);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { pgRefId: true, pgClientRef: true },
    });

    if (!order) {
      logger.error(`[ing1Fallback] Order not found: ${orderId}`);
      return;
    }

    const reff = opts.reff ?? order.pgRefId ?? undefined;
    const clientReff = opts.clientReff ?? order.pgClientRef ?? orderId;

    if (!reff) {
      logger.error(`[ing1Fallback] No reff found for order: ${orderId}`);
      return;
    }

    const resp = await client.checkCashin({ reff, clientReff });
    const data = resp.data ?? {};

    await processIng1Update({
      orderId,
      rc: resp.rc,
      statusText: (data.status as string) ?? resp.status,
      billerReff: resp.reff ?? reff,
      clientReff: resp.clientReff ?? clientReff,
      grossAmount:
        parseIng1Number(data.total ?? data.amount ?? data.gross_amount ?? data.grossAmount) ?? undefined,
      paymentReceivedTime:
        parseIng1Date(data.paid_at ?? data.payment_received_time ?? data.paidAt) ?? undefined,
      settlementTime:
        parseIng1Date(data.settlement_time ?? data.settled_at ?? data.settlementTime) ?? undefined,
      expirationTime:
        parseIng1Date(data.expired_at ?? data.expiration_time ?? data.expirationTime) ?? undefined,
    });

    logger.info(`[ing1Fallback] resend processed for ${orderId}`);
  } catch (err: any) {
    logger.error(`[ing1Fallback] resend error for ${orderId}: ${err.message}`);
  }
}

export async function scheduleIng1Fallback(
  orderId: string,
  cfg: Ing1Config,
  opts: FallbackOptions = {}
) {
  const delayMs = 3 * 60 * 1000;
  const nextRetry = moment().tz('Asia/Jakarta').add(delayMs, 'ms').toDate();

  try {
    await prisma.ing1CallbackWatcher.upsert({
      where: { orderId },
      update: { attemptCount: 0, processed: false, nextRetryAt: nextRetry },
      create: { orderId, attemptCount: 0, processed: false, nextRetryAt: nextRetry },
    });
  } catch (err: any) {
    logger.error(`[ing1Fallback] failed to register watcher for ${orderId}: ${err.message}`);
    return;
  }

  const checkAndResend = async () => {
    try {
      const watcher = await prisma.ing1CallbackWatcher.findUnique({
        where: { orderId },
      });
      if (!watcher || watcher.processed) return;

      const cb = await prisma.transaction_callback.findFirst({
        where: { referenceId: orderId },
      });
      if (cb) {
        await prisma.ing1CallbackWatcher.update({
          where: { orderId },
          data: { processed: true },
        });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          status: true,
          pgRefId: true,
          pgClientRef: true,
        },
      });

      if (!order || order.status !== 'PENDING') {
        await prisma.ing1CallbackWatcher.update({
          where: { orderId },
          data: { processed: true },
        });
        return;
      }

      const reff = opts.reff ?? order.pgRefId ?? undefined;
      const clientReff = opts.clientReff ?? order.pgClientRef ?? orderId;

      if (!reff) {
        await prisma.ing1CallbackWatcher.update({
          where: { orderId },
          data: { processed: true },
        });
        return;
      }

      logger.info(`[ing1Fallback] fetching status for ${orderId}`);
      const client = new Ing1Client(cfg);
      const resp = await client.checkCashin({ reff, clientReff });
      const status = evaluateFinalStatus(resp);

      if (status) {
        await resendCallback(orderId, cfg, opts);
        await prisma.ing1CallbackWatcher.update({
          where: { orderId },
          data: { processed: true, attemptCount: watcher.attemptCount + 1 },
        });
        return;
      }

      const attempts = watcher.attemptCount + 1;
      const backoffs = [10, 40];
      if (attempts >= 3) {
        await prisma.ing1CallbackWatcher.update({
          where: { orderId },
          data: { attemptCount: attempts },
        });
        return;
      }

      const nextDelay = backoffs[attempts - 1] * 60 * 1000;
      const nextTime = moment().tz('Asia/Jakarta').add(nextDelay, 'ms').toDate();
      await prisma.ing1CallbackWatcher.update({
        where: { orderId },
        data: { attemptCount: attempts, nextRetryAt: nextTime },
      });
      setTimeout(checkAndResend, nextDelay);
    } catch (err: any) {
      logger.error(`[ing1Fallback] error for ${orderId}: ${err.message}`);
    }
  };

  setTimeout(checkAndResend, delayMs);
}
