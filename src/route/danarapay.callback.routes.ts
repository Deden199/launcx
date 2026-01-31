// File: src/route/danarapay.callback.routes.ts
// DanaRpay VA Aggregator Routes - Based on official API docs v1.2.4
// DanaRapay as Source of Truth - callbacks update status, ledger handles balance

import { Router, json, Request, Response, NextFunction } from 'express';
import {
  danarapayVaCallback,
  danarapayDisbursementCallback,
  createDanarapayVa,
  getDanarapayVaInfo,
  updateDanarapayVa,
  simulateDanarapayCallback,
  getDanarapayVaBanks,
} from '../controller/danarapayVa.controller';
import apiKeyAuth from '../middleware/apiKeyAuth';
import { callbackAuditMiddleware, callbackSecurityMiddleware } from '../middleware/callbackSecurity';

const danarapayRouter = Router();

// ===================== JSON PARSER =====================
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

// ===================== CALLBACK ROUTE (PUBLIC) =====================
// Gate 4: Callback Security - ENFORCED with token verification
// Invalid requests will be rejected with 401/403

/**
 * @swagger
 * /api/v1/payments/danarapay/va/callback:
 *   post:
 *     summary: DanaRpay VA Payment Callback
 *     description: |
 *       Webhook endpoint untuk menerima notifikasi pembayaran VA dari DanaRpay.
 *       
 *       DanaRpay akan mengirim callback saat:
 *       - User berhasil melakukan pembayaran
 *       - Status settlement berubah (WAITING -> SUCCESS)
 *       
 *       Security: X-Callback-Token header REQUIRED for authentication
 *     tags:
 *       - DanaRpay VA
 *     security: []
 *     parameters:
 *       - in: header
 *         name: X-Callback-Token
 *         schema:
 *           type: string
 *         required: true
 *         description: Callback authentication token (REQUIRED)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               va_number:
 *                 type: string
 *                 description: Generated VA number
 *               amount:
 *                 type: integer
 *                 description: Amount of VA transaction
 *               partner_user_id:
 *                 type: string
 *                 description: Partner unique ID for specific user
 *               success:
 *                 type: string
 *                 description: Payment status (always "true" on success)
 *               tx_date:
 *                 type: string
 *                 description: Transaction date (format dd/MM/yyyy'T'HH:mm:ss.SSSZZZZ)
 *               username_display:
 *                 type: string
 *                 description: VA display name
 *               partner_trx_id:
 *                 type: string
 *                 description: Partner unique transaction ID
 *               trx_id:
 *                 type: string
 *                 description: Unique ID of incoming payment
 *               settlement_status:
 *                 type: string
 *                 enum: [WAITING, SUCCESS]
 *                 description: Settlement status
 *           example:
 *             va_number: "910306000000000028"
 *             amount: 20000
 *             partner_user_id: "e8df1d97-56c2-4fcf-9aa6-0b42d688ba7b"
 *             success: "true"
 *             tx_date: "2025-07-01 20:12:30"
 *             username_display: "johndoe"
 *             partner_trx_id: "91065e08-be93-4970-b0db-e10c0e3dac42"
 *             trx_id: "2da3c897-fc31-4bd9-b729-7a7a2ead29d8"
 *             settlement_status: "SUCCESS"
 *     responses:
 *       '200':
 *         description: Callback acknowledged
 *       '400':
 *         description: Bad request
 *       '500':
 *         description: Server error
 */
danarapayRouter.post(
  '/va/callback',
  flexibleJsonParser,
  callbackSecurityMiddleware({ requireToken: true }), // Gate 4: ENFORCED - rejects invalid tokens
  danarapayVaCallback
);

/**
 * @swagger
 * /api/v1/payments/danarapay/disbursement/callback:
 *   post:
 *     summary: DanaRpay Disbursement Callback
 *     description: |
 *       Webhook endpoint untuk menerima notifikasi status disbursement dari DanaRpay.
 *       
 *       DanaRapay status codes (Source of Truth):
 *       - 000: Success (Final)
 *       - 101: In Progress
 *       - 300: Failed (Final)
 *       - 301: Pending
 *       
 *       Callback ini HANYA mengubah status withdrawal.
 *       Balance adjustment dilakukan oleh ledger service.
 *     tags:
 *       - DanaRpay Disbursement
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               partner_trx_id:
 *                 type: string
 *                 description: Partner's withdrawal ID
 *               trx_id:
 *                 type: string
 *                 description: DanaRapay transaction ID
 *               status:
 *                 type: object
 *                 properties:
 *                   code:
 *                     type: string
 *                     enum: ["000", "101", "300", "301"]
 *                   message:
 *                     type: string
 *               amount:
 *                 type: integer
 *     responses:
 *       '200':
 *         description: Callback acknowledged
 */
danarapayRouter.post(
  '/disbursement/callback',
  flexibleJsonParser,
  callbackAuditMiddleware, // Gate 4: Audit mode - logs all callbacks
  danarapayDisbursementCallback
);

// ===================== API ROUTES (PROTECTED) =====================

/**
 * @swagger
 * /api/v1/payments/danarapay/va/create:
 *   post:
 *     summary: Create Virtual Account
 *     description: |
 *       Generate VA number via DanaRpay.
 *       
 *       Supported banks: BRI (002), Mandiri (008), BNI (009), Permata (013), CIMB (022)
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
 *               - partner_user_id
 *               - bank_code
 *               - username_display
 *             properties:
 *               partner_user_id:
 *                 type: string
 *                 description: Partner unique identifier for specific user
 *               bank_code:
 *                 type: string
 *                 description: "Bank code: 002 (BRI), 008 (Mandiri), 009 (BNI), 013 (Permata), 022 (CIMB)"
 *               amount:
 *                 type: integer
 *                 description: Amount in IDR (required if is_open=false)
 *               is_open:
 *                 type: boolean
 *                 description: true = open amount (default), false = closed amount
 *               is_single_use:
 *                 type: boolean
 *                 description: true = close VA after payment
 *               expiration_time:
 *                 type: integer
 *                 description: VA expiration time in minutes (default 1440 = 24 hours)
 *               is_lifetime:
 *                 type: boolean
 *                 description: true = VA never expires
 *               username_display:
 *                 type: string
 *                 description: Display name shown to user (min 3 chars)
 *               email:
 *                 type: string
 *                 description: User email
 *               full_name:
 *                 type: string
 *                 description: End-user full name
 *               partner_trx_id:
 *                 type: string
 *                 description: Partner unique transaction ID
 *           example:
 *             partner_user_id: "e8df1d97-56c2-4fcf-9aa6-0b42d688ba7b"
 *             bank_code: "002"
 *             amount: 20000
 *             is_open: false
 *             is_single_use: true
 *             expiration_time: 30
 *             username_display: "johndoe"
 *             partner_trx_id: "TRX-001"
 *     responses:
 *       '200':
 *         description: VA created successfully
 *       '400':
 *         description: Bad request
 *       '500':
 *         description: Server error
 */
danarapayRouter.post('/va/create', apiKeyAuth, createDanarapayVa);

/**
 * @swagger
 * /api/v1/payments/danarapay/va/info/{vaId}:
 *   get:
 *     summary: Get VA Info
 *     description: Get VA information by unique VA ID
 *     tags:
 *       - DanaRpay VA
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: vaId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique VA ID from create response
 *     responses:
 *       '200':
 *         description: VA info retrieved
 *       '400':
 *         description: Bad request
 *       '500':
 *         description: Server error
 */
danarapayRouter.get('/va/info/:vaId', apiKeyAuth, getDanarapayVaInfo);

/**
 * @swagger
 * /api/v1/payments/danarapay/va/update/{vaId}:
 *   put:
 *     summary: Update VA
 *     description: |
 *       Update VA by unique VA ID.
 *       Set expiration_time=0 to deactivate/cancel the VA.
 *     tags:
 *       - DanaRpay VA
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: vaId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique VA ID from create response
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: integer
 *               is_single_use:
 *                 type: boolean
 *               expiration_time:
 *                 type: integer
 *                 description: Set to 0 to deactivate VA
 *               username_display:
 *                 type: string
 *               partner_trx_id:
 *                 type: string
 *     responses:
 *       '200':
 *         description: VA updated successfully
 *       '400':
 *         description: Bad request
 *       '500':
 *         description: Server error
 */
danarapayRouter.put('/va/update/:vaId', apiKeyAuth, updateDanarapayVa);

/**
 * @swagger
 * /api/v1/payments/danarapay/va/simulate-callback:
 *   post:
 *     summary: Simulate VA Payment (Staging Only)
 *     description: Simulate VA payment callback in staging environment
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
 *               - id
 *               - amount
 *             properties:
 *               id:
 *                 type: string
 *                 description: Unique VA ID
 *               amount:
 *                 type: integer
 *                 description: Payment amount
 *           example:
 *             id: "45a8acac-aafc-40b8-b09c-99527a676f2b"
 *             amount: 20000
 *     responses:
 *       '200':
 *         description: Simulation result
 *       '400':
 *         description: Bad request
 *       '500':
 *         description: Server error
 */
danarapayRouter.post('/va/simulate-callback', apiKeyAuth, simulateDanarapayCallback);

/**
 * @swagger
 * /api/v1/payments/danarapay/va/banks:
 *   get:
 *     summary: Get Available Bank Codes
 *     description: List all available banks for VA creation
 *     tags:
 *       - DanaRpay VA
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       '200':
 *         description: Banks list
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
 *                         properties:
 *                           code:
 *                             type: string
 *                           name:
 *                             type: string
 *                           features:
 *                             type: array
 *                             items:
 *                               type: string
 */
danarapayRouter.get('/va/banks', apiKeyAuth, getDanarapayVaBanks);

export default danarapayRouter;
