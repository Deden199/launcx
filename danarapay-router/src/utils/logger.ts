// src/utils/logger.ts
import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.isProduction ? 'info' : 'debug',
  transport: config.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
  base: {
    service: 'danarapay-router',
    env: config.nodeEnv,
  },
});

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
