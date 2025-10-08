import Queue from 'bull';
import logger from '../logger';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB) || 0,
};

// Create payment processing queue
export const paymentQueue = new Queue('payment-processing', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 500, // Keep last 500 failed jobs
  },
  limiter: {
    max: 100, // Max 100 jobs
    duration: 1000, // Per 1 second
  },
});

// Create callback delivery queue
export const callbackQueue = new Queue('callback-delivery', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
  limiter: {
    max: 50,
    duration: 1000,
  },
});

// Create HiloGate status check queue
export const statusCheckQueue = new Queue('status-check', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 3000,
    },
    removeOnComplete: 50,
    removeOnFail: 200,
  },
  limiter: {
    max: 20, // Limit HiloGate API calls
    duration: 1000,
  },
});

// Queue event handlers
paymentQueue.on('completed', (job) => {
  logger.info(`[PaymentQueue] Job ${job.id} completed`);
});

paymentQueue.on('failed', (job, err) => {
  logger.error(`[PaymentQueue] Job ${job?.id} failed:`, err);
});

paymentQueue.on('error', (error) => {
  logger.error('[PaymentQueue] Queue error:', error);
});

callbackQueue.on('completed', (job) => {
  logger.info(`[CallbackQueue] Job ${job.id} completed`);
});

callbackQueue.on('failed', (job, err) => {
  logger.error(`[CallbackQueue] Job ${job?.id} failed:`, err);
});

statusCheckQueue.on('completed', (job) => {
  logger.info(`[StatusCheckQueue] Job ${job.id} completed`);
});

statusCheckQueue.on('failed', (job, err) => {
  logger.error(`[StatusCheckQueue] Job ${job?.id} failed:`, err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('[Queue] Closing queues...');
  await paymentQueue.close();
  await callbackQueue.close();
  await statusCheckQueue.close();
  logger.info('[Queue] Queues closed');
});

export default {
  paymentQueue,
  callbackQueue,
  statusCheckQueue,
};