// src/app.ts
import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
// import cron from 'node-cron'; // ❌ tidak dipakai di file ini, biar tidak bikin bingung
import { errorHandler } from './middleware/errorHandler';
import { scheduleSettlementChecker, getSettlementCronStatus } from './cron/settlement'; // ⬅️ tambah getSettlementCronStatus
import { scheduleDashboardSummary } from './cron/dashboardSummary';

import subMerchantRoutes from './route/admin/subMerchant.routes';
import pgProviderRoutes from './route/admin/pgProvider.routes';
import adminMerchantRoutes from './route/admin/merchant.routes';
import adminClientRoutes from './route/admin/client.routes';
import adminClientUserRoutes from './route/admin/clientUser.routes';

import adminTotpRoutes from './route/admin/totp.routes';
import adminLogRoutes from './route/admin/log.routes';
import adminIpWhitelistRoutes from './route/admin/ipWhitelist.routes';
import adminSettlementRoutes from './route/admin/settlement.routes';

import usersRoutes from './route/users.routes';

import settingsRoutes from './route/settings.routes';
import { loadWeekendOverrideDates } from './util/time';

import { withdrawalCallback, ing1WithdrawalCallback, piroWithdrawalCallback } from './controller/withdrawals.controller';
import pivotCallbackRouter from './route/payment.callback.routes';
import danarapayRouter from './route/danarapay.callback.routes';

import webRoutes from './route/web.routes';
import simulateRoutes from './route/simulate.routes';

import ewalletRoutes from './route/ewallet.routes';
import authRoutes from './route/auth.routes';
import paymentRouter from './route/payment.routes';
import paymentRouterV2 from './route/payment.v2.routes';

import bankRoutes from './route/bank.routes';
import { proxyOyQris } from './controller/qr.controller';

// import disbursementRouter from './route/disbursement.routes';
import {
  transactionCallback,
  oyTransactionCallback,
  gidiTransactionCallback,
  ing1TransactionCallback,
} from './controller/payment';

import merchantDashRoutes from './route/merchant/dashboard.routes';
import clientWebRoutes from './route/client/web.routes'; // partner-client routes
import withdrawalRoutes from './route/withdrawals.routes'; // add withdrawal routes
import withdrawalS2SRoutes from './route/withdrawals.s2s.routes';
import internalRoutes from './route/internal.routes'; // internal admin routes

import apiKeyAuth from './middleware/apiKeyAuth';
import { authMiddleware } from './middleware/auth';
import { globalIpWhitelist } from './middleware/ipWhitelist';
import { clientApiLogger } from './middleware/clientApiLogger';

import { config } from './config';
import logger from './logger';
import requestLogger from './middleware/log';

// ⬇️ Tambahan anti-crash IFP
import { ensureIfpReady } from './util/ifpSign';
import { disconnectPrisma } from './core/prisma'; // Import the disconnect function

const app = express();

// cek readiness IFP sekali di startup (tidak melempar error)
const IFP_ENABLED = ensureIfpReady();

const rateLimitExemptPaths = new Set([
  '/api/v1/transaction/callback',
  '/api/v1/transactions/callback',
  '/api/v1/transaction/callback/gidi',
  '/api/v1/transaction/callback/ing1',
  '/api/v1/transaction/callback/oy',
  '/api/v1/withdrawals/callback',
  '/api/v1/withdrawals/callback/piro',
  '/api/v1/withdrawals/callback/ing1',
  '/api/v1/payments/va-aggregator/va/callback',
]);

loadWeekendOverrideDates().catch(err => console.error('[init]', err));

app.disable('etag');

// === Global JSON parser (simpan rawBody) ===
app.use(express.json({
  verify: (req, _res, buf) => { (req as any).rawBody = buf }
}));

// No-cache headers
app.use((_, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Raw parser for Hilogate transaction webhook
app.post(
  '/api/v1/transactions/callback',
  express.raw({
    limit: '20kb',
    type: () => true,
    verify: (req, _res, buf: Buffer) => { (req as any).rawBody = buf }
  }),
  express.json(),
  transactionCallback
);

app.post(
  '/api/v1/withdrawals/callback',
  express.raw({
    type: '*/*', // terima JSON / octet-stream apa saja
    limit: '2mb', // payload WD aman
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString('utf8'); // simpan mentah
    },
  }),
  withdrawalCallback // ⛔ TANPA express.json()
);

app.post(
  '/api/v1/withdrawals/callback/piro',
  express.raw({
    type: '*/*',
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString('utf8');
    },
  }),
  piroWithdrawalCallback,
);

app.get('/api/v1/withdrawals/callback/ing1', ing1WithdrawalCallback);

app.post(
  '/api/v1/transaction/callback/gidi',
  express.raw({
    limit: '20kb',
    type: () => true,
    verify: (req, _res, buf: Buffer) => { (req as any).rawBody = buf }
  }),
  express.json(),
  gidiTransactionCallback
);

app.get('/api/v1/transaction/callback/ing1', ing1TransactionCallback);

app.post('/api/v1/transaction/callback/oy', oyTransactionCallback);

// Raw parser for Hilogate withdrawal webhook
app.get('/api/v1/qris/:orderId', proxyOyQris);

// Global middleware
app.set('trust proxy', 1);
app.use(globalIpWhitelist);
app.use(helmet());
app.use(rateLimit({
  windowMs: config.api.rateLimit.windowMs,
  max: config.api.rateLimit.max,
  message: 'Too many requests, try again later.',
  skip: (req) => rateLimitExemptPaths.has(req.path),
}));
app.use(cors({
  origin: true,
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-Timestamp',
    'X-Signature',
    'Accept',
    'User-Agent',
    'Referer',
    'Origin'
  ],
  exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
}));
app.use(requestLogger);

// Ops endpoint: pantau status IFP (berguna lihat di prod)
app.get('/ops/ifp-status', (_req, res) => {
  res.json({ ifpEnabled: IFP_ENABLED });
});

// Endpoint cek status cron (BIAR GAK NEBAK)
app.get('/ops/cron-status', (_req, res) => {
  res.json({ settlement: getSettlementCronStatus() });
});

// Routes ringan lain
app.use('/api/v1/withdrawals', withdrawalRoutes);
app.use('/api/v1/withdrawals/s2s', withdrawalS2SRoutes);
app.use('/api/v1', bankRoutes);

/* ========== 1. PUBLIC ROUTES ========== */
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1', ewalletRoutes);

/* ========== 2. PAYMENTS ========== */
/** ⬇⬇⬇ PENTING: pasang PIVOT CALLBACK DULU biar ga ketabrak router lain ⬇⬇⬇ */
app.use('/api/v1/payments', pivotCallbackRouter);
/** DanaRpay VA Aggregator routes */
app.use('/api/v1/payments/va-aggregator', danarapayRouter);
/** Legacy & V2 menyusul */
app.use('/api/v1/payments', apiKeyAuth, paymentRouter);
app.use('/api/v1/payments', paymentRouterV2);
app.use('/api/v1/payments/legacy', apiKeyAuth, paymentRouter);

// app.use('/api/v1/disbursements', apiKeyAuth, disbursementRouter);
app.use('/api/v1', simulateRoutes);

/* ========== 3. ADMIN PANEL ========== */
app.use('/api/v1/admin/merchants', authMiddleware, adminMerchantRoutes);
app.use('/api/v1/admin/merchants/:id/pg', authMiddleware, subMerchantRoutes);
app.use('/api/v1/admin/pg-providers', authMiddleware, pgProviderRoutes);
app.use('/api/v1/admin/clients', authMiddleware, adminClientRoutes);
app.use('/api/v1/admin/users', authMiddleware, usersRoutes);
app.use('/api/v1/admin/clients/:clientId/users', adminClientUserRoutes);
app.use('/api/v1/admin/settings', authMiddleware, settingsRoutes);
app.use('/api/v1/admin/2fa', adminTotpRoutes);
app.use('/api/v1/admin/logs', adminLogRoutes);
app.use('/api/v1/admin/ip-whitelist', authMiddleware, adminIpWhitelistRoutes);
app.use('/api/v1/admin/settlement', authMiddleware, adminSettlementRoutes);

/* ========== 3.5 INTERNAL ROUTES (Manual Resend) ========== */
app.use('/api/v1/internal', authMiddleware, internalRoutes);

/* ========== 4. PARTNER-CLIENT ========== */
app.use('/api/v1/client', clientApiLogger, clientWebRoutes);

/* ========== 5. MERCHANT DASHBOARD ========== */
app.use('/api/v1/merchant/dashboard', authMiddleware, merchantDashRoutes);
app.use('/web', webRoutes);

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// Start server
app.use(errorHandler);

// Removed duplicate immediate listen and duplicate cron bootstrap. The single server
// start and cron bootstrap happen inside the async IIFE below to ensure graceful
// shutdown wiring and single initialization.
// scheduleSettlementChecker().catch(err => logger.error(err));
// scheduleDashboardSummary();
// scheduleLoanSettlementCron();
// 🔽 Bootstrap cron lebih awal (dengan log sukses) — lalu listen
(async () => {
  try {
    await scheduleSettlementChecker();
    logger.info('[SettlementCron] bootstrapped & scheduled');
  } catch (err) {
    logger.error('[SettlementCron] init failed', err);
  }

  // Jika ingin aktifkan yang lain:
  // try { scheduleDashboardSummary(); logger.info('[DashboardSummary] scheduled'); } catch (e) { logger.error('[DashboardSummary] init failed', e); }
  // try { scheduleLoanSettlementCron(); logger.info('[LoanSettlementCron] scheduled'); } catch (e) { logger.error('[LoanSettlementCron] init failed', e); }
  try {
    scheduleDashboardSummary();
    logger.info('[DashboardSummary] scheduled');
  } catch (e) {
    logger.error('[DashboardSummary] init failed', e);
  }
  const server = app.listen(config.api.port, () => {
    logger.info(`[HTTP] listening on ${config.api.port}`);
  });
  
  const gracefulShutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    
    await disconnectPrisma();
    
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };
  
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
})();


export default app;
