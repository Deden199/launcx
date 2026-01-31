# Launcx Payment Gateway - Product Requirements Document

## Project Overview

Launcx is a payment gateway platform supporting QRIS and Virtual Account (VA) payments for Indonesian merchants. The system consists of:

1. **launcx-core** - Main monolith application (Node.js/Express + Prisma + Next.js frontend)
2. **danarapay-router** - Dedicated microservice for DanaRapay integration (VA, QRIS, Disbursement)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    launcx-core (Main Application)                   │
│  • Authentication & Authorization                                   │
│  • Client Dashboard (Overview, VA, QRIS, Withdrawal)                │
│  • Admin Dashboard                                                  │
│  • Settlement Processing                                            │
│  • Database (MongoDB via Prisma)                                    │
│  • Internal Webhook: POST /api/v1/internal/webhook                  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────────┐
│                    danarapay-router (Microservice)                  │
│  Port: 4000                                                         │
│  ├── /api/va/*         - VA management                             │
│  ├── /api/qris/*       - QRIS payment                              │
│  ├── /api/disbursement/* - Withdrawal                              │
│  ├── /api/inquiry/*    - Account validation                        │
│  ├── /api/callback/*   - DanaRapay webhooks (SECURED)              │
│  └── /healthz, /readyz - Health probes                             │
│                                                                     │
│  Security: IP Whitelist + URL Token                                │
│  Infrastructure: Redis (idempotency), Retry with backoff           │
└─────────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────────┐
│                        DanaRapay API                                │
│  Production: https://partner.danarapay.com                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Completed Features

### ✅ P0 - Callback Security (2025-01-31)
- IP Whitelist validation (`DANARAPAY_IP_WHITELIST` env)
- URL Token validation (`CALLBACK_SECRET_TOKEN` env)
- Default DENY if whitelist empty
- CIDR notation support

### ✅ P0 - End-to-End Business Flow Dashboard
- New `/client/overview` page showing complete business flow
- VA → Transaction → Balance → Withdrawal visualization
- Unified stats from VA and QRIS channels

### ✅ P1 - Database Query Optimization
- Added indexes: `[partnerClientId, channel, status]`, `[partnerClientId, channel, createdAt]`
- Cursor-based pagination for VA Dashboard
- Parallel query execution with Promise.all
- Projection-based field selection

### ✅ P1 - VA Dashboard Enhancement
- Dedicated VA monitoring page
- Real-time stats (Total, Pending, Success, Expired)
- Bank and status filters
- Search by ID/Player ID
- Infinite scroll with cursor pagination
- Expandable row details

### ✅ P3 - API Documentation
- Complete integration guide at `/docs`
- Node.js/TypeScript SDK examples
- cURL examples for all endpoints
- Callback handler implementation guide

---

## Database Schema Indexes

```prisma
model Order {
  @@index([partnerClientId])
  @@index([createdAt])
  @@index([status])
  @@index([channel])
  @@index([subMerchantId, status, createdAt])
  @@index([userId])
  @@index([pgRefId])
  @@index([partnerClientId, status, createdAt])
  @@index([partnerClientId, channel, status])
  @@index([partnerClientId, channel, createdAt])
  @@index([merchantId, createdAt])
}
```

---

## Key API Endpoints

### Client Dashboard
- `GET /api/v1/client/overview` - Business overview (new, optimized)
- `GET /api/v1/client/dashboard` - QRIS transactions
- `GET /api/v1/client/va-dashboard` - VA transactions
- `GET /api/v1/client/withdrawals` - Withdrawal history

### VA Management
- `POST /api/v1/payments/danarapay/va/create` - Create VA
- `GET /api/v1/payments/danarapay/va/info/:id` - Get VA info
- `PUT /api/v1/payments/danarapay/va/update/:id` - Update VA

### DanaRapay Router Callbacks (SECURED)
- `POST /api/callback/va/:token` - VA payment callback
- `POST /api/callback/qris/:token` - QRIS payment callback

---

## Environment Configuration

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
ROUTER_API_KEY=router_key

# Callback Security
CALLBACK_SECRET_TOKEN=<generated_token>
DANARAPAY_IP_WHITELIST=103.150.60.52,103.150.60.53
```

---

## Files Modified/Created This Session

### New Files
- `/app/frontend/src/pages/client/overview.tsx` - Business overview dashboard
- `/app/src/controller/clientOverview.controller.ts` - Optimized overview API
- `/app/danarapay-router/` - Complete microservice (all files)

### Modified Files
- `/app/src/controller/clientDashboard.controller.ts` - Cursor pagination for VA
- `/app/src/prisma/schema.prisma` - Added channel indexes
- `/app/src/route/client/web.routes.ts` - Added overview route
- `/app/src/core/redis.ts` - Added 'overview' TTL type
- `/app/frontend/src/pages/client/va-dashboard.tsx` - Enhanced UI
- `/app/frontend/src/pages/docs.tsx` - Added Node.js examples

---

## Remaining Tasks

### P0 - Critical (Before Go-Live)
- [ ] Get DanaRapay production IP whitelist
- [ ] Set production `CALLBACK_SECRET_TOKEN`
- [ ] Deploy `danarapay-router` to production server
- [ ] Configure DanaRapay dashboard callback URLs

### P1 - Important
- [ ] End-to-end test: Create VA → Payment → Callback → Dashboard
- [ ] Load testing with cursor pagination
- [ ] Monitor query performance

### P2 - Enhancement
- [ ] Add correlation/requestId to all logs
- [ ] Cleanup unused imports and files
- [ ] Add TypeScript strict mode

### P3 - Future
- [ ] Real-time dashboard updates (WebSocket/SSE)
- [ ] Email notifications for large withdrawals
- [ ] Multi-language support for docs

---

## Test Credentials

- **API Key (test)**: `658986ac-04ea-413e-aa62-0572ce97afef`
- **Callback Token (test)**: `bZuaFqrmgNcuSlWbm0WQDCJMVmElhNa1CPpsJytYJ0`

---

Last Updated: 2025-01-31
