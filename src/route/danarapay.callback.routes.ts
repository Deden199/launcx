// File: src/route/danarapay.callback.routes.ts
// DanaRpay VA Aggregator Routes

import { Router, json, Request, Response, NextFunction } from 'express';
import {
  danarapayVaCallback,
  createDanarapayVa,
  getDanarapayVaStatus,
  getDanarapayVaBanks,
} from '../controller/danarapayVa.controller';
import apiKeyAuth from '../middleware/apiKeyAuth';

const danarapayRouter = Router();

// ===================== JSON PARSER =====================
// Flexible JSON parser untuk callback (handle various content-types)
const flexibleJsonParser = json({
  limit: '1mb',
  type: (req) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    return (
      ct === '' ||
      ct.includes('application/json') ||
      ct.endsWith('/json') ||
      ct.includes('+json') ||
      ct.includes('text/plain')
    );
  },
});

// Debug middleware (optional, untuk troubleshooting)
function debugCallback(req: Request, _res: Response, next: NextFunction) {
  (req as any)._danarapayDebug = {
    contentType: req.headers['content-type'],
    signature: req.headers['x-signature'],
    timestamp: req.headers['x-timestamp'],
  };
  next();
}

// ===================== CALLBACK ROUTE (PUBLIC) =====================

/**
 * @swagger
 * /api/v1/payments/danarapay/va/callback:
 *   post:
 *     summary: DanaRpay VA Payment Callback
 *     description: Webhook endpoint untuk menerima notifikasi pembayaran VA dari DanaRpay
 *     tags:
 *       - DanaRpay VA
 *     security: []
 *     requestBody:
 *       description: Callback payload dari DanaRpay
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               trx_id:
 *                 type: string
 *                 description: Transaction ID dari DanaRpay
 *               partner_trx_id:
 *                 type: string
 *                 description: Partner reference ID (Launcx order ID)
 *               va_number:
 *                 type: string
 *                 description: Virtual Account number
 *               bank_code:
 *                 type: string
 *                 description: Bank code (BCA, BNI, etc.)
 *               amount:
 *                 type: number
 *                 description: Transaction amount
 *               paid_amount:
 *                 type: number
 *                 description: Paid amount
 *               status:
 *                 type: string
 *                 enum: [PENDING, PAID, EXPIRED, CANCELLED]
 *               paid_at:
 *                 type: string
 *                 format: date-time
 *               signature:
 *                 type: string
 *                 description: Callback signature for verification
 *     responses:
 *       '200':
 *         description: Callback acknowledged
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       '400':
 *         description: Bad request
 *       '401':
 *         description: Invalid signature
 *       '500':
 *         description: Server error
 */
danarapayRouter.post(
  '/va/callback',
  debugCallback,
  flexibleJsonParser,
  danarapayVaCallback
);

// ===================== API ROUTES (PROTECTED) =====================

/**
 * @swagger
 * /api/v1/payments/danarapay/va/create:
 *   post:
 *     summary: Create Virtual Account
 *     description: Generate VA number via DanaRpay
 *     tags:
 *       - DanaRpay VA
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bankCode
 *               - customerName
 *             properties:
 *               partnerTrxId:
 *                 type: string
 *                 description: Unique reference ID (optional, will be generated if not provided)
 *               bankCode:
 *                 type: string
 *                 description: Bank code (BCA, BNI, MANDIRI, BRI, PERMATA, etc.)
 *               amount:
 *                 type: number
 *                 description: Amount in IDR (optional for open-amount VA)
 *               customerName:
 *                 type: string
 *                 description: Customer name
 *               customerEmail:
 *                 type: string
 *                 description: Customer email
 *               customerPhone:
 *                 type: string
 *                 description: Customer phone
 *               expirationMinutes:
 *                 type: number
 *                 description: VA expiration in minutes (default 1440 = 24 hours)
 *               description:
 *                 type: string
 *                 description: Transaction description
 *     responses:
 *       '200':
 *         description: VA created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     partnerTrxId:
 *                       type: string
 *                     trxId:
 *                       type: string
 *                     vaNumber:
 *                       type: string
 *                     bankCode:
 *                       type: string
 *                     bankName:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     expiredAt:
 *                       type: string
 *                     status:
 *                       type: string
 *       '400':
 *         description: Bad request
 *       '500':
 *         description: Server error
 */
danarapayRouter.post('/va/create', apiKeyAuth, createDanarapayVa);

/**
 * @swagger
 * /api/v1/payments/danarapay/va/status/{partnerTrxId}:
 *   get:
 *     summary: Get VA Status
 *     description: Check VA payment status
 *     tags:
 *       - DanaRpay VA
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: partnerTrxId
 *         required: true
 *         schema:
 *           type: string
 *         description: Partner transaction reference ID
 *     responses:
 *       '200':
 *         description: VA status retrieved
 *       '400':
 *         description: Bad request
 *       '500':
 *         description: Server error
 */
danarapayRouter.get('/va/status/:partnerTrxId', apiKeyAuth, getDanarapayVaStatus);

/**
 * @swagger
 * /api/v1/payments/danarapay/va/banks:
 *   get:
 *     summary: Get Available Bank Channels
 *     description: List all available banks for VA creation
 *     tags:
 *       - DanaRpay VA
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       '200':
 *         description: Banks list retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     banks:
 *                       type: array
 *                       items:
 *                         type: object
 *       '500':
 *         description: Server error
 */
danarapayRouter.get('/va/banks', apiKeyAuth, getDanarapayVaBanks);

export default danarapayRouter;
