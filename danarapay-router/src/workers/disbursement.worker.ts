// src/workers/disbursement.worker.ts
import { getDanarapayClient } from '../services/danarapay.client';
import {
  forwardToLauncxCore,
  buildDisbursementEvent,
} from '../services/forwarder.service';
import { logger } from '../utils/logger';
import { config } from '../config';
import {
  acquireLock,
  releaseLock,
  isProcessed,
  markProcessed,
  generateIdempotencyKey,
} from '../utils/redis';
import { DisbursementStatus } from '../types/danarapay.types';

interface PollQueueItem {
  remitId: string;
  partnerTrxId: string;
  createdAt: string;
  attempts?: number;
}

// In-memory poll queue (for simplicity)
// In production, use Redis or database for persistence
const pollQueue: Map<string, PollQueueItem> = new Map();

// Final statuses that don't need polling
const FINAL_STATUSES: DisbursementStatus[] = ['COMPLETE', 'FAILED', 'CANCELLED'];

/**
 * Add disbursement to polling queue
 */
export function addToPollQueue(item: PollQueueItem): void {
  pollQueue.set(item.remitId, { ...item, attempts: 0 });
  logger.info(
    { remitId: item.remitId, partnerTrxId: item.partnerTrxId },
    'Added disbursement to poll queue'
  );
}

/**
 * Remove from poll queue
 */
export function removeFromPollQueue(remitId: string): void {
  pollQueue.delete(remitId);
}

/**
 * Get poll queue size
 */
export function getPollQueueSize(): number {
  return pollQueue.size;
}

/**
 * Poll a single disbursement for status update
 */
async function pollDisbursement(item: PollQueueItem): Promise<void> {
  const log = logger.child({
    remitId: item.remitId,
    partnerTrxId: item.partnerTrxId,
    attempt: item.attempts,
  });

  // Generate idempotency key for final status
  const idempotencyKey = generateIdempotencyKey(
    'DANARAPAY',
    'DISBURSEMENT',
    item.remitId
  );

  // Check if already processed final status
  const processed = await isProcessed(idempotencyKey);
  if (processed) {
    log.info('Disbursement already processed, removing from queue');
    removeFromPollQueue(item.remitId);
    return;
  }

  // Acquire lock for this disbursement
  const lockKey = `lock:disbursement:poll:${item.remitId}`;
  const lockAcquired = await acquireLock(lockKey, 60); // 60 seconds lock
  if (!lockAcquired) {
    log.debug('Failed to acquire lock, skipping this poll cycle');
    return;
  }

  try {
    log.debug('Polling disbursement status');

    const client = getDanarapayClient();
    const response = await client.getDisbursementStatus({
      remit_id: item.remitId,
    });

    const status = response.remit_status;
    log.info({ status }, 'Got disbursement status');

    // Check if final status
    if (FINAL_STATUSES.includes(status)) {
      log.info({ status }, 'Disbursement reached final status');

      // Forward to launcx-core
      const event = buildDisbursementEvent(response);
      await forwardToLauncxCore(event);

      // Mark as processed
      await markProcessed(idempotencyKey);

      // Remove from queue
      removeFromPollQueue(item.remitId);

      log.info('Disbursement final status forwarded and removed from queue');
    } else {
      // Not final, increment attempt counter
      item.attempts = (item.attempts || 0) + 1;

      // Check max attempts
      if (item.attempts >= config.disbursementPolling.maxAttempts) {
        log.warn('Max poll attempts reached, removing from queue');
        removeFromPollQueue(item.remitId);

        // Forward current status anyway
        const event = buildDisbursementEvent(response);
        await forwardToLauncxCore(event);
      } else {
        // Update queue item
        pollQueue.set(item.remitId, item);
      }
    }
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to poll disbursement status');
    // Don't remove from queue on error, will retry next cycle
  } finally {
    await releaseLock(lockKey);
  }
}

/**
 * Run poll cycle for all queued disbursements
 */
async function runPollCycle(): Promise<void> {
  const items = Array.from(pollQueue.values());
  
  if (items.length === 0) {
    return;
  }

  logger.debug({ queueSize: items.length }, 'Running disbursement poll cycle');

  // Process in parallel with concurrency limit
  const CONCURRENCY = 5;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(pollDisbursement));
  }
}

let pollInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start disbursement polling worker
 */
export function startDisbursementWorker(): void {
  if (pollInterval) {
    logger.warn('Disbursement worker already running');
    return;
  }

  logger.info(
    { intervalMs: config.disbursementPolling.intervalMs },
    'Starting disbursement polling worker'
  );

  // Run immediately
  runPollCycle().catch((err) => {
    logger.error({ error: err.message }, 'Initial poll cycle failed');
  });

  // Schedule periodic runs
  pollInterval = setInterval(() => {
    runPollCycle().catch((err) => {
      logger.error({ error: err.message }, 'Poll cycle failed');
    });
  }, config.disbursementPolling.intervalMs);
}

/**
 * Stop disbursement polling worker
 */
export function stopDisbursementWorker(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info('Disbursement polling worker stopped');
  }
}
