import { Router } from 'express'
import { manualResendCallback } from '../controller/internal/hilogateFallback.controller'
import { handleInternalWebhook } from '../controller/internalWebhook.controller'

const router = Router()
router.post('/hilogate/resend-callback/:refId', manualResendCallback)

// Internal webhook from danarapay-router
router.post('/webhook', handleInternalWebhook)

export default router