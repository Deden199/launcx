// src/app.ts
import express, { Request, Response, NextFunction } from 'express';
import { requestLogger } from './middleware/logger.middleware';
import routes from './routes';
import { logger } from './utils/logger';

const app = express();

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// Health check endpoints (no auth required)
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'danarapay-router',
    timestamp: new Date().toISOString(),
  });
});

app.get('/readyz', (_req: Request, res: Response) => {
  // Add Redis/dependency checks here if needed
  res.json({
    status: 'ok',
    service: 'danarapay-router',
    ready: true,
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use('/api', routes);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');

  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

export default app;
