import { prisma } from '../core/prisma'
import { postWithRetry } from '../utils/postWithRetry'
import logger from '../logger'
import { config } from '../config'
import { Prisma } from '@prisma/client'

export async function processCallbackJobs() {
  let jobs

  try {
    jobs = await prisma.callbackJob.findMany({
      where: {
        delivered: false,
        attempts: { lt: config.api.callbackQueue.maxAttempts },
      },
      orderBy: { createdAt: 'asc' },
      take: config.api.callbackQueue.batchSize,
    })
  } catch (err: any) {
    // Handle legacy records with null partnerClientId
    if (err.code === 'P2032' && err.meta?.field === 'partnerClientId') {
      logger.error('[callbackQueue] Found legacy jobs with null partnerClientId. Cleaning up...')

      try {
        await prisma.$runCommandRaw({
          delete: 'CallbackJob',
          deletes: [{
            q: { partnerClientId: null },
            limit: 0
          }]
        })
        logger.info('[callbackQueue] Cleaned up legacy jobs with null partnerClientId')
      } catch (cleanupErr) {
        logger.error('[callbackQueue] Failed to cleanup legacy jobs:', cleanupErr)
      }
      return
    }
    throw err
  }

  for (const job of jobs) {
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
      })

      // If no rows were updated, another worker got it first
      if (lockedJob.count === 0) {
        continue
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
      )

      // Mark as delivered - use the already incremented attempts value
      try {
        await prisma.callbackJob.update({
          where: { id: job.id },
          data: { delivered: true, lastError: null },
        })
        logger.info(`[callbackQueue] delivered job ${job.id}`)
      } catch (updateErr: any) {
        // Job might have been deleted by another worker - that's okay
        if (updateErr.code === 'P2025') {
          logger.warn(`[callbackQueue] job ${job.id} already processed by another worker`)
        } else {
          throw updateErr
        }
      }

    } catch (err: any) {
      const attempts = job.attempts + 1
      const statusCode = err?.response?.status
      const isClientError = statusCode >= 400 && statusCode < 500
      const maxAttemptsReached = attempts >= config.api.callbackQueue.maxAttempts

      if (isClientError || maxAttemptsReached) {
        // Use a transaction to ensure atomicity and handle race conditions
        try {
          await prisma.$transaction(async (tx) => {
            // Check if job still exists before moving to dead letter
            const existingJob = await tx.callbackJob.findUnique({
              where: { id: job.id }
            })

            if (!existingJob) {
              logger.warn(`[callbackQueue] job ${job.id} already handled by another worker`)
              return
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
            })

            await tx.callbackJob.delete({ where: { id: job.id } })
          })

          logger.error(
              `[callbackQueue] moved job ${job.id} to dead-letter queue: ${err.message}`
          )
        } catch (txErr: any) {
          // If the delete fails because record doesn't exist, another worker handled it
          if (txErr.code === 'P2025') {
            logger.warn(`[callbackQueue] job ${job.id} already moved to dead-letter by another worker`)
          } else if (txErr instanceof Prisma.PrismaClientKnownRequestError && txErr.code === 'P2025') {
            logger.warn(`[callbackQueue] job ${job.id} already moved to dead-letter by another worker`)
          } else {
            logger.error(`[callbackQueue] failed to move job ${job.id} to dead-letter:`, txErr)
            // Don't throw - log and continue to next job
          }
        }
      } else {
        // Update attempt count, but catch if record doesn't exist
        try {
          await prisma.callbackJob.update({
            where: { id: job.id },
            data: { attempts, lastError: err.message },
          })
          logger.error(
              `[callbackQueue] delivery failed for job ${job.id}: ${err.message}`
          )
        } catch (updateErr: any) {
          if (updateErr.code === 'P2025') {
            logger.warn(`[callbackQueue] job ${job.id} already handled by another worker`)
          } else {
            logger.error(`[callbackQueue] failed to update job ${job.id}:`, updateErr)
            // Don't throw - log and continue to next job
          }
        }
      }
    }
  }
}

export function startCallbackWorker() {
  // Wrap processCallbackJobs to catch any unhandled errors
  setInterval(() => {
    processCallbackJobs().catch((err) => {
      logger.error('[callbackQueue] Unhandled error in processCallbackJobs:', err)
    })
  }, config.api.callbackQueue.intervalMs)
  logger.info('Callback worker started')
}

if (require.main === module) {
  // Handle unhandled promise rejections globally
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('[callbackQueue] Unhandled Promise Rejection:', reason)
  })

  startCallbackWorker()
}