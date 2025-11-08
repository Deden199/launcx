import { prisma } from '../core/prisma';
import logger from '../logger';
import { HilogateClient, HilogateConfig } from './hilogateClient';
import { processHilogatePayload } from './payment';
import moment from 'moment-timezone';

const FINAL_STATUSES = ['SUCCESS', 'EXPIRED', 'FAILED', 'COMPLETED'];

/**
 * Evaluasi apakah status transaksi final
 */
export function evaluateFinalStatus(resp: any): string | null {
  const status = resp?.data?.status ?? resp?.status;
  return FINAL_STATUSES.includes((status || '').toUpperCase())
    ? (status || '').toUpperCase()
    : null;
}

/**
 * Resend callback ke sistem internal
 * Semua error ditangkap dan dicatat, termasuk response body jika ada
 */
async function resendCallback(refId: string, cfg: HilogateConfig) {
  try {
    logger.info(`[hilogateFallback] resend callback for ${refId}`);
    const client = new HilogateClient(cfg);
    let resp: any;
    try {
      resp = await client.getTransaction(refId);
      logger.info(`[hilogateFallback] getTransaction success for ${refId}`, { response: resp });
    } catch (err: any) {
      if (err.response) {
        logger.error(`[hilogateFallback] getTransaction failed with response for ${refId}`, {
          status: err.response.status,
          data: err.response.data,
          stack: err.stack,
        });
      } else {
        logger.error(`[hilogateFallback] getTransaction failed for ${refId}: ${err.message}`, {
          stack: err.stack,
        });
      }
      return;
    }

    const data = resp.data ?? resp;
    logger.info(`[hilogateFallback] payload for processHilogatePayload`, { refId, data });

    try {
      await processHilogatePayload({
        ref_id: data.ref_id,
        amount: data.amount,
        method: data.method,
        status: data.status,
        net_amount: data.net_amount ?? data.settlement_amount,
        qr_string: data.qr_string,
        settlement_status: data.settlement_status,
      });
      logger.info(`[hilogateFallback] resend processed for ${refId}`);
    } catch (err: any) {
      logger.error(`[hilogateFallback] processHilogatePayload failed for ${refId}: ${err.message}`, {
        stack: err.stack,
        payload: data,
      });
    }
  } catch (err: any) {
    logger.error(`[hilogateFallback] unexpected error in resendCallback for ${refId}: ${err.message}`, {
      stack: err.stack,
    });
  }
}

/**
 * Schedule fallback untuk transaksi Hilogate
 */
export async function scheduleHilogateFallback(refId: string, cfg: HilogateConfig) {
  const initialDelayMs = 3 * 60 * 1000; // 3 menit
  const backoffs = [10, 40]; // menit untuk retry berikutnya

  // Hit pertama: simpan watcher di DB
  try {
    const nextRetry = moment().tz('Asia/Jakarta').add(initialDelayMs, 'ms').toDate();
    await prisma.hilogateCallbackWatcher.upsert({
      where: { refId },
      update: { attemptCount: 0, processed: false, nextRetryAt: nextRetry },
      create: { refId, attemptCount: 0, processed: false, nextRetryAt: nextRetry },
    });
    logger.info(`[hilogateFallback] watcher registered for ${refId}`);
  } catch (err: any) {
    logger.error(`[hilogateFallback] failed to register watcher for ${refId}: ${err.message}`, {
      stack: err.stack,
    });
    return;
  }

  const checkAndResend = async () => {
    try {
      const watcher = await prisma.hilogateCallbackWatcher.findUnique({ where: { refId } });
      if (!watcher || watcher.processed) return;

      // Cek apakah callback sudah tercatat
      const cb = await prisma.transaction_callback.findFirst({ where: { referenceId: refId } });
      if (cb) {
        await prisma.hilogateCallbackWatcher.update({
          where: { refId },
          data: { processed: true },
        });
        logger.info(`[hilogateFallback] callback already processed for ${refId}`);
        return;
      }

      // Ambil status terakhir dari Hilogate
      const client = new HilogateClient(cfg);
      let status: string | null = null;
      try {
        const resp = await client.getTransaction(refId);
        status = evaluateFinalStatus(resp);
        logger.info(`[hilogateFallback] getTransaction response for ${refId}`, { response: resp });
      } catch (err: any) {
        if (err.response) {
          logger.error(`[hilogateFallback] getTransaction failed with response for ${refId}`, {
            status: err.response.status,
            data: err.response.data,
            stack: err.stack,
          });
        } else {
          logger.error(`[hilogateFallback] getTransaction failed for ${refId}: ${err.message}`, {
            stack: err.stack,
          });
        }
      }

      // Jika status final, langsung resend callback
      if (status) {
        await resendCallback(refId, cfg);
        await prisma.hilogateCallbackWatcher.update({
          where: { refId },
          data: { processed: true, attemptCount: watcher.attemptCount + 1 },
        });
        return;
      }

      // Jika belum final, atur retry dengan backoff
      const attempts = watcher.attemptCount + 1;
      if (attempts >= 3) {
        await prisma.hilogateCallbackWatcher.update({
          where: { refId },
          data: { attemptCount: attempts },
        });
        logger.warn(`[hilogateFallback] max retry reached for ${refId}`);
        return;
      }

      const nextDelay = backoffs[attempts - 1] * 60 * 1000; // convert menit -> ms
      const nextTime = moment().tz('Asia/Jakarta').add(nextDelay, 'ms').toDate();
      await prisma.hilogateCallbackWatcher.update({
        where: { refId },
        data: { attemptCount: attempts, nextRetryAt: nextTime },
      });

      logger.info(`[hilogateFallback] scheduled next retry for ${refId} in ${backoffs[attempts - 1]} minutes`);
      setTimeout(checkAndResend, nextDelay);
    } catch (err: any) {
      logger.error(`[hilogateFallback] unexpected error for ${refId}: ${err.message}`, {
        stack: err.stack,
      });
      // Retry lagi setelah 5 menit jika terjadi error tidak terduga
      setTimeout(checkAndResend, 5 * 60 * 1000);
    }
  };

  // Mulai cek pertama setelah delay awal
  setTimeout(checkAndResend, initialDelayMs);
}
