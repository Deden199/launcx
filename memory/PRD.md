# PRD - Launcx Client Dashboard (Production Ready)

## Original Problem Statement
Sesuaikan client dashboard agar menampilkan juga data dari VA agar mereka bisa monitor transaksi.

## Production Deployment
- **URL:** `https://s2.launcx.com`
- **API Base:** `https://s2.launcx.com/api/v1`

## Features Implemented

### 1. Dashboard QRIS (`/client/dashboard`)
- Stats: Transactions, Pending Settlement, Total Settlement
- Filters: Date range, Status, Search
- Transaction list dengan pagination
- Export to Excel
- Navigation ke VA Dashboard

### 2. Virtual Account Dashboard (`/client/va-dashboard`)
- Stats Cards: Total VA, Pending, Success, Expired, Total Amount, Total Paid
- Tab **Transaksi VA**: List transaksi dengan filter (date, status, bank, search)
- Tab **VA Aktif**: Grid cards VA yang menunggu pembayaran
- Export to Excel
- Navigation kembali ke QRIS Dashboard

### 3. API Documentation (`/docs`)
- Complete integration guide
- QRIS payment flow
- VA payment flow (Create, Get Info, Update)
- Callback documentation
- Bank codes & status reference
- cURL examples

### 4. Backend Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/payments` | POST | Create QRIS payment |
| `/payments/danarapay/va/create` | POST | Create VA (saves to Order) |
| `/payments/danarapay/va/info/{id}` | GET | Get VA info |
| `/payments/danarapay/va/update/{id}` | PUT | Update VA |
| `/client/dashboard` | GET | QRIS dashboard data |
| `/client/va-dashboard` | GET | VA dashboard data |
| `/client/va-active` | GET | Active VA list |

## Key Changes Made

### Backend (`/app/src/controller/danarapayVa.controller.ts`)
- **CRITICAL:** Create VA now saves Order record with `channel: 'VA_DANARAPAY'`
- Order record enables VA to appear in client dashboard

### Frontend
- Removed all "DanaRapay" branding → "Virtual Account" / "VA"
- Updated docs with production URL `s2.launcx.com`
- Separated QRIS and VA dashboards for clarity

## Supported Banks
| Code | Bank |
|------|------|
| 002 | BRI |
| 008 | Mandiri |
| 009 | BNI |
| 013 | Permata |
| 022 | CIMB Niaga |

## Deployment Checklist
- [x] Backend TypeScript compiled
- [x] Frontend built
- [x] Branding cleaned (no DanaRapay mention)
- [x] Docs updated with s2.launcx.com URLs
- [x] VA create saves to Order table
- [ ] Deploy to s2.launcx.com
- [ ] Set environment variables
- [ ] Test with real VA transactions

## Environment Variables Required
```
# Frontend
NEXT_PUBLIC_API_URL=https://s2.launcx.com/api/v1

# Backend
DATABASE_URL=...
JWT_SECRET=...
DANARAPAY_API_URL=...
DANARAPAY_USERNAME=...
DANARAPAY_API_KEY=...
```

## Next Phase (P1)
- Create VA from dashboard UI
- Real-time VA payment notifications
- VA analytics charts
