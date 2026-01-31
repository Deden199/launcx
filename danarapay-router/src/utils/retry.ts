// src/utils/retry.ts
import { config } from '../config';
import { logger } from './logger';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

const defaultOptions: Required<RetryOptions> = {
  maxAttempts: config.retry.maxAttempts,
  baseDelayMs: config.retry.baseDelayMs,
  maxDelayMs: 30000,
  shouldRetry: () => true,
};

/**
 * Retry with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (attempt === opts.maxAttempts || !opts.shouldRetry(error)) {
        logger.error(
          {
            operation: operationName,
            attempt,
            maxAttempts: opts.maxAttempts,
            error: errorMessage,
          },
          'Operation failed after all retries'
        );
        throw error;
      }

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1),
        opts.maxDelayMs
      );

      logger.warn(
        {
          operation: operationName,
          attempt,
          maxAttempts: opts.maxAttempts,
          nextRetryMs: delay,
          error: errorMessage,
        },
        'Operation failed, retrying...'
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable (network errors, 5xx, etc.)
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Axios error
  if (typeof error === 'object' && 'response' in error) {
    const axiosError = error as { response?: { status?: number } };
    const status = axiosError.response?.status;
    // Retry on 5xx or network errors (no response)
    return !status || status >= 500;
  }

  // Network errors
  if (error instanceof Error) {
    const networkErrors = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'];
    return networkErrors.some((e) => error.message.includes(e));
  }

  return false;
}
