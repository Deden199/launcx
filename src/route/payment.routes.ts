// src/route/payment.routes.ts
import { Router } from 'express'
import paymentController from '../controller/payment'
import apiKeyAuth from '../middleware/apiKeyAuth'
import { redisRateLimit } from '../middleware/cache'
import { preventDuplicateOrder } from '../middleware/paymentCache'

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     apiKeyAuth:
 *       type: apiKey
 *       in: header
 *       name: x-api-key
 *   schemas:
 *     Transaction:
 *       type: object
 *       required:
 *         - merchantName
 *         - price
 *         - buyer
 *         - subMerchantId
 *         - sourceProvider
 *       properties:
 *         merchantName:
 *           type: string
 *           description: gv / hilogate / …
 *         price:
 *           type: number
 *         buyer:
 *           type: string
 *         flow:
 *           type: string
 *           enum: [embed, redirect]
 *         playerId:
 *           type: string
 *         subMerchantId:
 *           type: string
 *         sourceProvider:
 *           type: string
 *         paymentChannel:
 *           type: string
 *         customerEmail:
 *           type: string
 *         customerFullName:
 *           type: string
 *         customerPhone:
 *           type: string
 *         walletId:
 *           type: string
 *         walletIdType:
 *           type: string
 *         transactionDescription:
 *           type: string
 *         expiredTime:
 *           type: number
 *     OrderRequest:
 *       type: object
 *       required:
 *         - amount
 *         - userId
 *       properties:
 *         amount:
 *           type: number
 *           minimum: 1
 *         userId:
 *           type: string
 *         playerId:
 *           type: string
 *     OrderResponse:
 *       type: object
 *       properties:
 *         orderId:
 *           type: string
 *         checkoutUrl:
 *           type: string
 *         qrPayload:
 *           type: string
 *         playerId:
 *           type: string
 *         totalAmount:
 *           type: number
 *         expiredTs:
 *           type: string
 *     PaymentStatus:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 */

const paymentRouter = Router()

// Aggregator flow: create an aggregated order
paymentRouter.post(
  '/create-order',
  redisRateLimit({ windowMs: 60000, max: 15000 }), // Rate limit: 15000 req/min
  apiKeyAuth,
  preventDuplicateOrder(), // Prevent duplicate orders
  paymentController.createOrder
)
/**
 * @openapi
 * /create-order:
 *   post:
 *     summary: Create an aggregated order
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderRequest'
 *     responses:
 *       200:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderResponse'
 */

// Direct transaction: QR payload or redirect URL
paymentRouter.post(
  '/',
  redisRateLimit({ windowMs: 60000, max: 1000 }), // Rate limit: 1000 req/min
  apiKeyAuth,
  preventDuplicateOrder(), // Prevent duplicate orders
  paymentController.createTransaction
)
/**
 * @openapi
 * /:
 *   post:
 *     summary: Create a direct transaction
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Transaction'
 *     responses:
 *       200:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderResponse'
 */

// Payment gateway callback for transactions
paymentRouter.post(
  '/transaction/callback',
  paymentController.transactionCallback
)
/**
 * @openapi
 * /transaction/callback:
 *   post:
 *     summary: Payment gateway callback
 *     responses:
 *       200:
 *         description: Callback processed
 */

// Retrieve order details by ID
paymentRouter.get(
  '/order/:id',
  apiKeyAuth,
  paymentController.getOrder
)
/**
 * @openapi
 * /order/{id}:
 *   get:
 *     summary: Retrieve order details by ID
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderResponse'
 */
paymentRouter.post(
  '/transaction/callback/gidi',
  paymentController.gidiTransactionCallback,
)

paymentRouter.post(
  '/transaction/callback/piro',
  paymentController.piroTransactionCallback,
)
/**
 * @openapi
 * /transaction/callback/gidi:
 *   post:
 *     summary: GIDI payment callback
 *     responses:
 *       200:
 *         description: Callback processed
 */

// Check payment status by order ID
paymentRouter.get(
  '/order/:id/status',
  apiKeyAuth,
  paymentController.checkPaymentStatus
)
/**
 * @openapi
 * /order/{id}/status:
 *   get:
 *     summary: Check payment status by order ID
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentStatus'
 */
paymentRouter.post(
  '/transaction/callback/oy/retry/:referenceId',
  paymentController.retryOyCallback
);
/**
 * @openapi
 * /transaction/callback/oy/retry/{referenceId}:
 *   post:
 *     summary: Retry OY! callback
 *     parameters:
 *       - in: path
 *         name: referenceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Retry processed
 */

// =====================================================================
// PROVIDER-AGNOSTIC VA ROUTES (Client-Facing)
// These routes map to internal DanaRapay controller but expose
// generic endpoints to clients without revealing the provider.
// =====================================================================

import {
  createDanarapayVa,
  getDanarapayVaInfo,
  updateDanarapayVa,
  getDanarapayVaBanks,
} from '../controller/danarapayVa.controller';

/**
 * @openapi
 * /va:
 *   post:
 *     summary: Create Virtual Account
 *     description: Create a new VA for customer payment. Provider is selected automatically.
 *     tags:
 *       - Virtual Account
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customerId
 *               - bankCode
 *               - displayName
 *             properties:
 *               customerId:
 *                 type: string
 *                 description: Unique customer identifier
 *               bankCode:
 *                 type: string
 *                 description: Bank code (002=BRI, 008=Mandiri, 009=BNI, 013=Permata, 022=CIMB)
 *               amount:
 *                 type: number
 *                 description: Payment amount (required if isOpen=false)
 *               isOpen:
 *                 type: boolean
 *                 description: Open amount VA (default true)
 *               isSingleUse:
 *                 type: boolean
 *                 description: Close VA after payment (default false)
 *               expirationMinutes:
 *                 type: number
 *                 description: Expiration time in minutes (default 1440)
 *               displayName:
 *                 type: string
 *                 description: Name displayed to customer
 *               referenceId:
 *                 type: string
 *                 description: Your transaction reference ID
 *     responses:
 *       200:
 *         description: VA created successfully
 */
paymentRouter.post(
  '/va',
  redisRateLimit({ windowMs: 60000, max: 100 }),
  apiKeyAuth,
  createDanarapayVa
);

/**
 * @openapi
 * /va/{vaId}:
 *   get:
 *     summary: Get Virtual Account Info
 *     description: Retrieve VA details by ID
 *     tags:
 *       - Virtual Account
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: vaId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: VA details
 */
paymentRouter.get(
  '/va/:vaId',
  apiKeyAuth,
  getDanarapayVaInfo
);

/**
 * @openapi
 * /va/{vaId}:
 *   put:
 *     summary: Update Virtual Account
 *     description: Update VA amount or display name
 *     tags:
 *       - Virtual Account
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: vaId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *               displayName:
 *                 type: string
 *     responses:
 *       200:
 *         description: VA updated
 */
paymentRouter.put(
  '/va/:vaId',
  apiKeyAuth,
  updateDanarapayVa
);

/**
 * @openapi
 * /va/banks:
 *   get:
 *     summary: Get Supported Banks for VA
 *     description: List of available banks for VA creation
 *     tags:
 *       - Virtual Account
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of supported banks
 */
paymentRouter.get(
  '/va/banks',
  apiKeyAuth,
  getDanarapayVaBanks
);

export default paymentRouter
