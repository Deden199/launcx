# PRD - DanaRapay Router (Production Ready)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    launcx-core (Existing)                           │
│  • Auth, Dashboard, Settlement, Database                           │
│  • POST /api/v1/internal/webhook ← receives events from router     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────────┐
│                    danarapay-router (NEW REPO)                      │
│  Port: 4000                                                         │
│  ├── /api/va/*         - VA management                             │
│  ├── /api/qris/*       - QRIS payment                              │
│  ├── /api/disbursement/* - Withdrawal                              │
│  ├── /api/inquiry/*    - Account validation                        │
│  ├── /api/callback/*   - DanaRapay webhooks                        │
│  ├── /healthz          - Liveness                                  │
│  └── /readyz           - Readiness                                 │
│                                                                     │
│  Workers:                                                          │
│  • Disbursement polling (no webhook from DanaRapay)                │
│                                                                     │
│  Infrastructure:                                                   │
│  • Redis lock (idempotency)                                        │
│  • Retry with exponential backoff                                  │
│  • Structured logging (pino)                                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────────┐
│                        DanaRapay API                                 │
│  Staging: https://api-stg.danarapay.com                             │
│  Production: https://partner.danarapay.com                          │
└─────────────────────────────────────────────────────────────────────┘
```

## Files Created

### danarapay-router/
```
src/
├── index.ts                  # Entry point
├── app.ts                    # Express app
├── config.ts                 # Environment config
├── routes/
│   ├── index.ts              # Route aggregator
│   ├── va.routes.ts          # VA endpoints
│   ├── qris.routes.ts        # QRIS endpoints
│   ├── disbursement.routes.ts # Disbursement endpoints
│   ├── inquiry.routes.ts     # Account inquiry
│   └── callback.routes.ts    # Callback handlers
├── services/
│   ├── danarapay.client.ts   # HTTP client to DanaRapay
│   └── forwarder.service.ts  # Forward events to launcx-core
├── workers/
│   └── disbursement.worker.ts # Polling worker
├── middleware/
│   ├── auth.middleware.ts    # API key auth
│   ├── idempotency.middleware.ts # Redis lock
│   └── logger.middleware.ts  # Request logging
├── utils/
│   ├── redis.ts              # Redis client & lock
│   ├── logger.ts             # Pino logger
│   └── retry.ts              # Retry with backoff
└── types/
    ├── danarapay.types.ts    # DanaRapay API types
    └── internal.types.ts     # Unified event types
```

### launcx-core/ (modified)
- `src/controller/internalWebhook.controller.ts` - Handle events from router
- `src/route/internal.routes.ts` - Added `/webhook` endpoint

## Unified Event Payload

```json
{
  "eventType": "VA|QRIS|DISBURSEMENT",
  "provider": "DANARAPAY",
  "partnerTrxId": "TRX-001",
  "providerTrxId": "uuid-from-danarapay",
  "amount": 50000,
  "status": "SUCCESS|PENDING|FAILED|EXPIRED",
  "providerStatus": "COMPLETE",
  "paidAt": "2025-01-30T10:00:00Z",
  "settledAt": "2025-01-30T10:05:00Z",
  "settlementStatus": "SUCCESS",
  "metadata": { ... },
  "rawPayload": { ... },
  "processedAt": "2025-01-30T10:00:05Z"
}
```

## Idempotency Implementation

- Lock key format: `lock:DANARAPAY:{eventType}:{uniqueId}`
- Using Redis `SET NX EX` (atomic acquire)
- TTL: 300 seconds for lock, 24 hours for processed marker
- Unique ID:
  - VA: `trx_id` (per payment transaction)
  - QRIS: `trx_id:settlement_status` (handles 2nd callback)
  - Disbursement: `remit_id`

## Disbursement Polling

DanaRapay doesn't have webhook for disbursement, so:
1. On create → add to in-memory poll queue
2. Worker polls every 30 seconds
3. On final status (COMPLETE/FAILED) → forward to launcx-core
4. Max 100 attempts before giving up

## DanaRapay Callback URLs (SECURED)

Set in DanaRapay dashboard (replace `<TOKEN>` with actual CALLBACK_SECRET_TOKEN):
- VA: `https://your-router-domain/api/callback/va/<TOKEN>`
- QRIS: `https://your-router-domain/api/callback/qris/<TOKEN>`

### Callback Security (Implemented: 2025-01-31)
Two-layer security for callback endpoints:
1. **IP Whitelist**: `DANARAPAY_IP_WHITELIST` env variable (comma-separated IP/CIDR)
   - Default: DENY ALL if empty (secure by default)
   - Supports CIDR notation (e.g., `10.0.0.0/8`)
2. **URL Path Token**: Secret token embedded in URL path
   - Generate: `openssl rand -base64 32 | tr -d '/+='`

## Environment Variables

### danarapay-router/.env
```bash
PORT=4000
NODE_ENV=production
DANARAPAY_BASE_URL=https://partner.danarapay.com
DANARAPAY_USERNAME=xxx
DANARAPAY_API_KEY=xxx
REDIS_URL=redis://localhost:6379
LAUNCX_CORE_WEBHOOK_URL=http://launcx-core:5000/api/v1/internal/webhook
LAUNCX_CORE_INTERNAL_SECRET=shared_secret
ROUTER_API_KEY=router_key_for_launcx_to_call

# Callback Security (REQUIRED)
CALLBACK_SECRET_TOKEN=your_strong_random_token
DANARAPAY_IP_WHITELIST=103.150.60.52,103.150.60.53
```

### launcx-core/.env (add)
```bash
INTERNAL_WEBHOOK_SECRET=shared_secret
```

## Deployment

### Run danarapay-router
```bash
cd danarapay-router
yarn install
yarn build
NODE_ENV=production node dist/index.js
```

### Run with PM2
```bash
pm2 start dist/index.js --name danarapay-router
```

## Testing Flow

1. **Create VA via router**:
   ```bash
   curl -X POST http://router:4000/api/va/create \
     -H "X-Router-Api-Key: xxx" \
     -H "Content-Type: application/json" \
     -d '{"partner_user_id":"user-1","bank_code":"008","amount":50000,"username_display":"Test"}'
   ```

2. **Simulate payment (staging)**:
   ```bash
   curl -X POST http://router:4000/api/callback/simulate/va \
     -d '{"va_id":"xxx"}'
   ```

3. **Check callback forwarded to launcx-core**

## Next Steps

- [ ] Deploy danarapay-router to server
- [ ] Configure DanaRapay callback URLs
- [ ] Update launcx-core to call router instead of DanaRapay directly
- [ ] Test end-to-end flow
- [ ] Monitor logs & metrics
