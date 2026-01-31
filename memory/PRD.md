# Launcx Payment Gateway - Product Requirements Document

## Project Overview

Launcx is a payment gateway platform supporting QRIS and Virtual Account (VA) payments for Indonesian merchants.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    launcx-core (Main Application)                   │
│  • Node.js/Express Backend + Prisma ORM + Next.js Frontend          │
│  • Client Dashboard showing business flow:                          │
│    VA/QRIS → Transaction → Balance → Withdrawal                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────────┐
│                    danarapay-router (Microservice)                  │
│  • Dedicated gateway for DanaRapay integration                     │
│  • Security: IP Whitelist + URL Token                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Completed Upgrades (2025-01-31)

### ✅ P0 - Callback Security for danarapay-router
- IP Whitelist validation (`DANARAPAY_IP_WHITELIST` env)
- URL Token validation (`CALLBACK_SECRET_TOKEN` env)
- Default DENY if whitelist empty
- CIDR notation support

### ✅ P1 - Query Optimization di Core Controllers

**`clientDashboard.controller.ts` - getClientDashboard:**
- ✅ Cursor-based pagination (`createdAt + _id`)
- ✅ Minimal projection (removed `qrPayload` - large field not needed)
- ✅ Summary withdrawal dalam response (`withdrawalStats`)
- ✅ Response mencerminkan alur bisnis: VA/QRIS → Transaksi → Saldo → Withdrawal

**`clientDashboard.controller.ts` - getVaDashboard:**
- ✅ Cursor-based pagination
- ✅ Minimal projection

**`withdrawals.controller.ts` - listWithdrawals:**
- ✅ Cursor-based pagination (`createdAt + refId`)

### ✅ P2 - Database Indexes
Added composite indexes for common query patterns:
```prisma
@@index([partnerClientId, channel, status])
@@index([partnerClientId, channel, createdAt])
```

### ✅ P3 - API Documentation
- Updated `/docs` page with Node.js/TypeScript SDK examples
- Complete callback handler implementation guide

---

## API Response Structure

### GET /api/v1/client/dashboard

Response reflects business flow: VA/QRIS → Transaction → Balance → Withdrawal

```json
{
  "balance": 1500000,              // Saldo aktif (available for withdrawal)
  "totalPending": 250000,         // Transaction pending settlement
  "totalSettlement": 1200000,     // Total settled
  "totalPaid": 1450000,           // Total paid (including pending)
  
  "total": 156,                   // Transaction count
  "hasMore": true,                // For cursor pagination
  "nextCursor": "2025-01-31T10:00:00.000Z_abc123",
  
  "transactions": [...],
  
  "vaStats": {
    "created": 45,
    "pending": 3,
    "success": 40,
    "expired": 2,
    "totalAmount": 500000
  },
  
  "withdrawalStats": {            // NEW: Withdrawal summary
    "pending": 2,
    "pendingAmount": 200000,
    "completed": 15,
    "completedAmount": 1000000,
    "failed": 1
  },
  
  "children": [...],
  "vaBanks": [...]
}
```

### GET /api/v1/client/withdrawals

Now supports cursor pagination:
```
?cursor=2025-01-31T10:00:00.000Z_REF123&limit=20
```

Response:
```json
{
  "data": [...],
  "total": 50,
  "hasMore": true,
  "nextCursor": "2025-01-31T09:00:00.000Z_REF100"
}
```

---

## Cursor Pagination Format

Consistent format across all endpoints: `{createdAt}_{id}`

- **Transactions**: `createdAt_orderId`
- **Withdrawals**: `createdAt_refId`
- **VA**: Uses Prisma cursor on `id`

---

## Files Modified

### Core Controllers (Optimized)
- `/app/src/controller/clientDashboard.controller.ts`
  - getClientDashboard: cursor pagination, minimal projection, withdrawal stats
  - getVaDashboard: cursor pagination
- `/app/src/controller/withdrawals.controller.ts`
  - listWithdrawals: cursor pagination

### Database Schema
- `/app/src/prisma/schema.prisma` - Added channel indexes

### Routes
- `/app/src/route/client/web.routes.ts` - Cleaned up

### Frontend
- `/app/frontend/src/pages/client/va-dashboard.tsx` - Enhanced UI with cursor pagination
- `/app/frontend/src/pages/docs.tsx` - Added Node.js examples

---

## Remaining Tasks

### P0 - Before Go-Live
- [ ] Get DanaRapay production IP whitelist
- [ ] Set production `CALLBACK_SECRET_TOKEN`
- [ ] Deploy `danarapay-router` to production

### P1 - Testing
- [ ] End-to-end test: VA Create → Payment → Callback → Dashboard
- [ ] Load test cursor pagination with large dataset

### P2 - Future Enhancements
- [ ] Real-time updates (WebSocket/SSE)
- [ ] Query performance monitoring
- [ ] More detailed logging with correlation IDs

---

## Test Credentials

- **API Key (test)**: `658986ac-04ea-413e-aa62-0572ce97afef`
- **Callback Token (test)**: `bZuaFqrmgNcuSlWbm0WQDCJMVmElhNa1CPpsJytYJ0`

---

Last Updated: 2025-01-31
