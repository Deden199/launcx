// src/config.ts
import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export const config = {
  // Server
  port: parseInt(optionalEnv('PORT', '4000'), 10),
  nodeEnv: optionalEnv('NODE_ENV', 'staging') as 'staging' | 'production',
  isProduction: process.env.NODE_ENV === 'production',

  // DanaRapay API
  danarapay: {
    baseUrl: optionalEnv(
      'DANARAPAY_BASE_URL',
      'https://api-stg.danarapay.com'
    ),
    username: requireEnv('DANARAPAY_USERNAME'),
    apiKey: requireEnv('DANARAPAY_API_KEY'),
  },

  // Redis
  redis: {
    url: optionalEnv('REDIS_URL', 'redis://localhost:6379'),
  },

  // Launcx Core
  launcxCore: {
    webhookUrl: requireEnv('LAUNCX_CORE_WEBHOOK_URL'),
    internalSecret: requireEnv('LAUNCX_CORE_INTERNAL_SECRET'),
  },

  // Router Auth
  routerApiKey: requireEnv('ROUTER_API_KEY'),

  // Disbursement Polling
  disbursementPolling: {
    intervalMs: parseInt(optionalEnv('DISBURSEMENT_POLL_INTERVAL_MS', '30000'), 10),
    maxAttempts: parseInt(optionalEnv('DISBURSEMENT_POLL_MAX_ATTEMPTS', '100'), 10),
  },

  // Idempotency
  idempotency: {
    lockTtlSeconds: parseInt(optionalEnv('IDEMPOTENCY_LOCK_TTL', '300'), 10),
  },

  // Retry
  retry: {
    maxAttempts: parseInt(optionalEnv('RETRY_MAX_ATTEMPTS', '3'), 10),
    baseDelayMs: parseInt(optionalEnv('RETRY_BASE_DELAY_MS', '1000'), 10),
  },

  // Callback Security
  callbackSecretToken: requireEnv('CALLBACK_SECRET_TOKEN'),
  
  // DanaRapay IP Whitelist (comma-separated IP/CIDR)
  // If empty, ALL callbacks will be DENIED (secure by default)
  danarapayCallbackIps: (() => {
    const ips = process.env.DANARAPAY_IP_WHITELIST || '';
    return ips.split(',').map(ip => ip.trim()).filter(ip => ip.length > 0);
  })(),
};

// Production URL mapping
export function getDanarapayUrl(): string {
  return config.isProduction
    ? 'https://partner.danarapay.com'
    : config.danarapay.baseUrl;
}
