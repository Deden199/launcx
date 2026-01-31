# DanaRapay Router

Standalone microservice for DanaRapay payment integration (VA, QRIS, Disbursement).

## Architecture

```
launcx-core ←→ danarapay-router ←→ DanaRapay API
                    ↑
            DanaRapay Callbacks
```

## Features

- **Virtual Account (VA)**: Create, update, get info, deactivate
- **QRIS**: Create transaction, check status
- **Disbursement**: Create, check status, get balance, polling worker
- **Account Inquiry**: Validate bank account
- **Callback Handling**: Idempotent processing with Redis lock
- **Forward to launcx-core**: Unified webhook payload

## Endpoints

### VA
- `POST /api/va/create` - Create VA
- `GET /api/va/:id` - Get VA info
- `PUT /api/va/:id` - Update VA
- `DELETE /api/va/:id` - Deactivate VA
- `GET /api/va/banks/list` - List supported banks

### QRIS
- `POST /api/qris/create` - Create QRIS payment
- `GET /api/qris/status/:partnerTrxId` - Check status

### Disbursement
- `POST /api/disbursement/create` - Create disbursement
- `GET /api/disbursement/status/:partnerTrxId` - Check status
- `GET /api/disbursement/balance` - Get balance

### Account Inquiry
- `POST /api/inquiry/account` - Validate bank account
- `GET /api/inquiry/banks` - List supported banks

### Callbacks (from DanaRapay) - SECURED
- `POST /api/callback/va/:token` - VA payment callback
- `POST /api/callback/qris/:token` - QRIS payment callback

**Security Layers:**
1. IP Whitelist (DANARAPAY_IP_WHITELIST) - requests from non-whitelisted IPs are rejected
2. URL Token (CALLBACK_SECRET_TOKEN) - :token in URL must match env variable

### Simulation (Staging only)
- `POST /api/callback/simulate/va` - Simulate VA payment
- `POST /api/callback/simulate/qris` - Simulate QRIS payment

### Health
- `GET /healthz` - Liveness probe
- `GET /readyz` - Readiness probe

## Internal Webhook Payload

All events forwarded to launcx-core use this unified format:

```json
{
  "eventType": "VA|QRIS|DISBURSEMENT",
  "provider": "DANARAPAY",
  "partnerTrxId": "string",
  "providerTrxId": "string",
  "amount": 50000,
  "status": "PENDING|WAITING_PAYMENT|SUCCESS|FAILED|EXPIRED",
  "providerStatus": "string",
  "paidAt": "2025-01-30T10:00:00Z",
  "settledAt": "2025-01-30T10:05:00Z",
  "settlementStatus": "string",
  "metadata": { ... },
  "rawPayload": { ... },
  "processedAt": "2025-01-30T10:00:05Z"
}
```

## Environment Variables

```bash
# Server
PORT=4000
NODE_ENV=staging|production

# DanaRapay API
DANARAPAY_BASE_URL=https://api-stg.danarapay.com
DANARAPAY_USERNAME=your_username
DANARAPAY_API_KEY=your_api_key

# Redis
REDIS_URL=redis://localhost:6379

# Launcx Core
LAUNCX_CORE_WEBHOOK_URL=http://localhost:5000/api/v1/internal/webhook
LAUNCX_CORE_INTERNAL_SECRET=shared_secret

# Router Auth
ROUTER_API_KEY=your_router_api_key

# Disbursement Polling
DISBURSEMENT_POLL_INTERVAL_MS=30000
DISBURSEMENT_POLL_MAX_ATTEMPTS=100

# Callback Security (REQUIRED)
CALLBACK_SECRET_TOKEN=your_strong_random_token
DANARAPAY_IP_WHITELIST=103.150.60.52,103.150.60.53,10.0.0.0/8
```

## Callback Security

### IP Whitelist
Configure `DANARAPAY_IP_WHITELIST` with comma-separated IP addresses or CIDR ranges:
```bash
DANARAPAY_IP_WHITELIST=103.150.60.52,103.150.60.53,10.0.0.0/8
```

**IMPORTANT:** If whitelist is empty, ALL callbacks are DENIED (secure by default).

### Secret Token
Generate a strong random token:
```bash
openssl rand -base64 32 | tr -d '/+='
```

The token is part of the callback URL path for additional security.

## DanaRapay Callback URLs

Set these in DanaRapay dashboard (replace `YOUR_SECRET_TOKEN` with actual token):
- VA Callback: `https://your-domain/api/callback/va/YOUR_SECRET_TOKEN`
- QRIS Callback: `https://your-domain/api/callback/qris/YOUR_SECRET_TOKEN`

**Example with production domain:**
```
https://s2.launcx.com/api/callback/va/bZuaFqrmgNcuSlWbm0WQDCJMVmElhNa1CPpsJytYJ0
```

## Development

```bash
# Install dependencies
yarn install

# Run in development
yarn dev

# Build
yarn build

# Run production
yarn start
```

## Authentication

### Internal API (from launcx-core)
Header: `X-Router-Api-Key: <ROUTER_API_KEY>`

### Forwarding to launcx-core
Header: `X-Internal-Secret: <LAUNCX_CORE_INTERNAL_SECRET>`

## Idempotency

Callbacks are processed idempotently using Redis:
- Lock key: `lock:DANARAPAY:{eventType}:{uniqueId}`
- Processed key: `processed:DANARAPAY:{eventType}:{uniqueId}`
- TTL: 300 seconds (lock), 24 hours (processed)

## Disbursement Polling

Since DanaRapay doesn't have disbursement webhook, this service polls:
1. On create disbursement, add to poll queue
2. Worker polls every 30 seconds
3. On final status (COMPLETE/FAILED), forward to launcx-core
4. Max 100 attempts before giving up

## Supported Banks

### VA
- BRI (002)
- Mandiri (008)
- BNI (009)
- Permata (013)
- CIMB (022)

### Disbursement
100+ banks and e-wallets including:
- Major banks: BCA, BRI, Mandiri, BNI, CIMB, etc.
- E-wallets: DANA, GoPay, OVO, ShopeePay, LinkAja
