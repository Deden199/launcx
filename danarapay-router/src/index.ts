// src/index.ts
import app from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { getRedis, closeRedis } from './utils/redis';
import { startDisbursementWorker, stopDisbursementWorker } from './workers/disbursement.worker';

async function main() {
  try {
    // Initialize Redis connection
    logger.info('Initializing Redis connection...');
    getRedis();

    // Start disbursement polling worker
    startDisbursementWorker();

    // Start HTTP server
    const server = app.listen(config.port, () => {
      logger.info(
        {
          port: config.port,
          env: config.nodeEnv,
          danarapayUrl: config.danarapay.baseUrl,
        },
        `DanaRapay Router started`
      );
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutdown signal received');

      // Stop accepting new connections
      server.close(() => {
        logger.info('HTTP server closed');
      });

      // Stop workers
      stopDisbursementWorker();

      // Close Redis
      await closeRedis();

      logger.info('Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to start server');
    process.exit(1);
  }
}

main();
