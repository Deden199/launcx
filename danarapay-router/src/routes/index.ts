// src/routes/index.ts
import { Router } from 'express';
import vaRoutes from './va.routes';
import qrisRoutes from './qris.routes';
import disbursementRoutes from './disbursement.routes';
import inquiryRoutes from './inquiry.routes';
import callbackRoutes from './callback.routes';

const router = Router();

// Mount routes
router.use('/va', vaRoutes);
router.use('/qris', qrisRoutes);
router.use('/disbursement', disbursementRoutes);
router.use('/inquiry', inquiryRoutes);
router.use('/callback', callbackRoutes);

export default router;
