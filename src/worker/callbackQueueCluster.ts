import cluster from 'cluster';
import os from 'os';
import { prisma } from '../core/prisma';
import { postWithRetry } from '../utils/postWithRetry';
import logger from '../logger';
import { config } from '../config';

/**
 * Optimized Callback Queue Worker with Cluster Support
 *
 * Features:
 * - Multi-process worker pool (uses all CPUs)
 * - Job distribution across workers
 * - Parallel job processing
 * - Worker-level concurrency
 * - Automatic recovery on crash
 * - Resource optimization for C5.4xlarge (16 vCPUs)
 */

const WORKER_CONCURRENCY = 10; // Each worker processes 10 jobs concurrently
const WORKERS_COUNT = parseInt(process.env.CALLBACK_WORKERS || '8'); // 8 workers for 16 vCPUs

// Worker ID for job distribution (from PM2 or cluster)
const WORKER_ID = parseInt(process.env.INSTANCE_ID || process.env.pm_id || '0');
const TOTAL_WORKERS = parseInt(process.env.instances || '1');

export async function processCallbackJobsConcurrent() {
  const workerId = WORKER_ID;
  const totalWorkers = TOTAL_WORKERS;

  try {
    // Fetch jobs with worker-based sharding
    // Each worker handles jobs where (job_index % totalWorkers) === workerId
    const allJobs = await prisma.callbackJob.findMany({
      where: {
        delivered: false,
        attempts: { lt: config.api.callbackQueue.maxAttempts },
      },
      orderBy: { createdAt: 'asc' },
      take: config.api.callbackQueue.batchSize * WORKER_CONCURRENCY,
    });

    if (allJobs.length === 0) return;

    // Distribute jobs across workers using modulo sharding
    const myJobs = allJobs.filter((_, index) => index % totalWorkers === workerId);

    if (myJobs.length === 0) return;

    logger.info(
      `[Worker ${workerId}] Processing ${myJobs.length}/${allJobs.length} jobs (${WORKER_CONCURRENCY} concurrent)`
    );

    // Process jobs in parallel batches
    const batches = [];
    for (let i = 0; i < myJobs.length; i += WORKER_CONCURRENCY) {
      batches.push(myJobs.slice(i, i + WORKER_CONCURRENCY));
    }

    for (const batch of batches) {
      await Promise.allSettled(
        batch.map((job) => processJob(job, workerId))
      );
    }
  } catch (err: any) {
    // Handle legacy records with null partnerClientId
    if (err.code === 'P2032' && err.meta?.field === 'partnerClientId') {
      logger.error('[callbackQueue] Found legacy jobs with null partnerClientId. Cleaning up...');

      try {
        await prisma.$runCommandRaw({
          delete: 'CallbackJob',
          deletes: [
            {
              q: { partnerClientId: null },
              limit: 0,
            },
          ],
        });
        logger.info('[callbackQueue] Cleaned up legacy jobs with null partnerClientId');
      } catch (cleanupErr) {
        logger.error('[callbackQueue] Failed to cleanup legacy jobs:', cleanupErr);
      }
      return;
    }
    logger.error(`[Worker ${WORKER_ID}] Error fetching jobs:`, err);
  }
}

async function processJob(job: any, workerId: number) {
  try {
    // Attempt to lock the job by updating it first (optimistic locking)
    const lockedJob = await prisma.callbackJob.updateMany({
      where: {
        id: job.id,
        attempts: job.attempts // Only update if attempts hasn't changed
      },
      data: {
        attempts: job.attempts + 1
      },
    });

    // If no rows were updated, another worker got it first
    if (lockedJob.count === 0) {
      logger.debug(`[Worker ${workerId}] Job ${job.id} already locked by another worker`);
      return;
    }

    // Now process the job
    await postWithRetry(
      job.url,
      job.payload,
      {
        headers: { 'X-Callback-Signature': job.signature },
        timeout: 5000,
      },
      3
    );

    // Mark as delivered - attempts already incremented during lock
    try {
      await prisma.callbackJob.update({
        where: { id: job.id },
        data: { delivered: true, lastError: null },
      });
      logger.info(`[Worker ${workerId}] Delivered job ${job.id}`);
    } catch (updateErr: any) {
      // Job might have been deleted by another worker - that's okay
      if (updateErr.code === 'P2025') {
        logger.warn(`[Worker ${workerId}] Job ${job.id} already processed by another worker`);
      } else {
        throw updateErr;
      }
    }

  } catch (err: any) {
    const attempts = job.attempts + 1;
    const statusCode = err?.response?.status;
    const isClientError = statusCode >= 400 && statusCode < 500;
    const maxAttemptsReached = attempts >= config.api.callbackQueue.maxAttempts;

    if (isClientError || maxAttemptsReached) {
      // Use a transaction to ensure atomicity and handle race conditions
      try {
        await prisma.$transaction(async (tx) => {
          // Check if job still exists before moving to dead letter
          const existingJob = await tx.callbackJob.findUnique({
            where: { id: job.id }
          });

          if (!existingJob) {
            logger.warn(`[Worker ${workerId}] Job ${job.id} already handled by another worker`);
            return;
          }

          await tx.callbackJobDeadLetter.create({
            data: {
              jobId: job.id,
              partnerClientId: job.partnerClientId,
              url: job.url,
              payload: job.payload,
              signature: job.signature,
              statusCode,
              errorMessage: err.message,
              responseBody: err.response?.data ?? null,
              attempts,
            },
          });

          await tx.callbackJob.delete({ where: { id: job.id } });
        });

        logger.error(`[Worker ${workerId}] Moved job ${job.id} to DLQ: ${err.message}`);
      } catch (txErr: any) {
        // If the delete fails because record doesn't exist, another worker handled it
        if (txErr.code === 'P2025') {
          logger.warn(`[Worker ${workerId}] Job ${job.id} already moved to DLQ by another worker`);
        } else {
          logger.error(`[Worker ${workerId}] Failed to move job ${job.id} to DLQ:`, txErr);
          // Don't throw - log and continue to next job
        }
      }
    } else {
      // Update attempt count, but catch if record doesn't exist
      try {
        await prisma.callbackJob.update({
          where: { id: job.id },
          data: { attempts, lastError: err.message },
        });
        logger.error(`[Worker ${workerId}] Failed job ${job.id}: ${err.message}`);
      } catch (updateErr: any) {
        if (updateErr.code === 'P2025') {
          logger.warn(`[Worker ${workerId}] Job ${job.id} already handled by another worker`);
        } else {
          logger.error(`[Worker ${workerId}] Failed to update job ${job.id}:`, updateErr);
          // Don't throw - log and continue to next job
        }
      }
    }
  }
}

export function startCallbackWorkerCluster() {
  const workerId = WORKER_ID;

  // Handle unhandled promise rejections globally
  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`[Worker ${workerId}] Unhandled Promise Rejection:`, reason);
  });

  logger.info(`[Worker ${workerId}] Callback worker started with ${WORKER_CONCURRENCY}x concurrency`);

  // Process jobs at interval with error handling
  setInterval(() => {
    processCallbackJobsConcurrent().catch((err) => {
      logger.error(`[Worker ${workerId}] Unhandled error in processCallbackJobsConcurrent:`, err);
    });
  }, config.api.callbackQueue.intervalMs);

  // Immediate first run
  processCallbackJobsConcurrent().catch((err) => {
    logger.error(`[Worker ${workerId}] Unhandled error in initial processCallbackJobsConcurrent:`, err);
  });
}

// Master process (only for standalone Node.js cluster mode, not needed for PM2)
if (cluster.isPrimary && !process.env.INSTANCE_ID) {
  const numWorkers = WORKERS_COUNT;

  logger.info(`[Master] Starting ${numWorkers} callback workers on ${os.cpus().length} CPUs`);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.error(`[Master] Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork();
  });
} else {
  // Worker process
  startCallbackWorkerCluster();
}

// Allow direct execution
if (require.main === module) {
  if (cluster.isPrimary && !process.env.INSTANCE_ID) {
    // Start in cluster mode
    const numWorkers = WORKERS_COUNT;
    logger.info(`Starting ${numWorkers} callback workers`);

    for (let i = 0; i < numWorkers; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker) => {
      logger.error(`Worker ${worker.process.pid} died. Restarting...`);
      cluster.fork();
    });
  } else {
    // Worker mode
    startCallbackWorkerCluster();
  }
}