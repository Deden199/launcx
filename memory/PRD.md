# Launcx - DanaRpay VA Aggregator Integration PRD

## Original Problem Statement
Integrasi Virtual Account (VA Aggregator) dari DanaRpay ke monorepo Launcx sesuai dokumentasi: https://api-docs.danarapay.com/#tag/VA-Aggregator

Target:
- Launcx bisa membuat VA
- Menerima callback/notification pembayaran
- Meng-update status transaksi secara idempotent

## Architecture

### Tech Stack
- Backend: Node.js + TypeScript + Express
- Database: MongoDB + Prisma
- Payment Gateway: DanaRpay VA Aggregator

### Components
```
Launcx Backend
├── src/service/danarapayClient.ts      # HTTP client
├── src/controller/danarapayVa.controller.ts  # Business logic
├── src/route/danarapay.callback.routes.ts    # API routes
└── src/config.ts                       # Configuration
```

## What's Been Implemented (Jan 2026)

### ✅ DanaRpay VA Integration
- [x] Create VA (`POST /api/generate-static-va`)
- [x] Get VA Info (`GET /api/static-virtual-account/{id}`)
- [x] Update VA (`PUT /api/static-virtual-account/{ID}`)
- [x] Simulate Callback (`POST /api/va-aggregator/simulate-callback`)
- [x] Callback handler with idempotent update
- [x] Support all 5 banks: BRI, Mandiri, BNI, Permata, CIMB

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/payments/danarapay/va/callback` | Webhook (public) |
| POST | `/api/v1/payments/danarapay/va/create` | Create VA |
| GET | `/api/v1/payments/danarapay/va/info/:vaId` | Get VA info |
| PUT | `/api/v1/payments/danarapay/va/update/:vaId` | Update VA |
| POST | `/api/v1/payments/danarapay/va/simulate-callback` | Simulate (staging) |
| GET | `/api/v1/payments/danarapay/va/banks` | List banks |

## Core Requirements (Static)

1. **Authentication**: `x-username` + `x-api-key` headers
2. **Banks**: 002 (BRI), 008 (Mandiri), 009 (BNI), 013 (Permata), 022 (CIMB)
3. **VA Types**: Open amount, Closed amount, Lifetime, Single-use
4. **Callback**: Idempotent processing, audit trail

## Environment Variables
```
DANARAPAY_BASE_URL=https://api-stg.danarapay.com
DANARAPAY_USERNAME=xxx
DANARAPAY_API_KEY=xxx
```

## Prioritized Backlog

### P0 (Done)
- [x] Create VA API
- [x] Callback handler
- [x] Get VA status
- [x] Update VA

### P1 (Next)
- [ ] Partner callback forwarding after payment
- [ ] VA expiry monitoring cron
- [ ] Dashboard UI for VA management

### P2 (Future)
- [ ] Batch VA creation
- [ ] VA reconciliation report
- [ ] Multi-merchant VA support

## Next Tasks
1. Set ENV variables dengan credentials dari DanaRpay
2. Register callback URL di DanaRpay Dashboard
3. Test end-to-end di staging environment
4. Implement partner callback forwarding
