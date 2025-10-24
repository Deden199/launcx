import { Router } from 'express'
import { manualResendCallback as hilogateFallbackController } from '../controller/internal/hilogateFallback.controller'
import { manualResendCallback as ing1FallbackController } from '../controller/internal/ing1Fallback.controller'
import { manualResendWithdrawalCallback as ing1WithdrawalFallbackController } from '../controller/internal/ing1WithdrawalFallback.controller'

const router = Router()
router.post('/hilogate/resend-callback/:refId', hilogateFallbackController)
router.post('/ing1/resend-callback/:orderId', ing1FallbackController)
router.post('/ing1/resend-withdrawal-callback/:refId', ing1WithdrawalFallbackController)

export default router