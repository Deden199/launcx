# PRD - Client Dashboard dengan VA DanaRapay (Terpisah)

## Original Problem Statement
Sesuaikan client dashboard agar menampilkan juga data dari VA DanaRapay agar mereka bisa monitor juga transaksi di danarapay.

## Root Cause & Fix (Jan 30, 2026)
**Problem:** VA yang di-create via API `/api/v1/payments/danarapay/va/create` tidak tersimpan ke database Order, sehingga tidak muncul di dashboard.

**Fix:** Updated `createDanarapayVa` controller untuk juga membuat record Order di database dengan:
- `channel: 'VA_DANARAPAY'`
- `status: 'PENDING'`
- `providerPayload: { va_number, bank_code, va_status, ... }`

## Architecture

### Halaman Dashboard

| Route | Halaman | Fungsi |
|-------|---------|--------|
| `/client/dashboard` | Dashboard QRIS | Monitor transaksi QRIS |
| `/client/va-dashboard` | Dashboard VA DanaRapay | Monitor transaksi & VA aktif DanaRapay |

### Backend Endpoints

| Endpoint | Handler | Fungsi |
|----------|---------|--------|
| `GET /client/dashboard` | `getClientDashboard` | Data dashboard (semua channel) |
| `GET /client/va-dashboard` | `getVaDashboard` | Data VA transactions + stats |
| `GET /client/va-active` | `getActiveVaList` | List VA yang masih menunggu pembayaran |
| `POST /payments/danarapay/va/create` | `createDanarapayVa` | **UPDATED** - Create VA + save to Order table |

### Files Modified
- `/app/src/controller/danarapayVa.controller.ts` - **CRITICAL FIX**: Added Order creation on VA create
- `/app/src/controller/clientDashboard.controller.ts` - Added `getVaDashboard`, `getActiveVaList`
- `/app/src/route/client/web.routes.ts` - Added routes
- `/app/frontend/src/pages/client/dashboard.tsx` - QRIS only dashboard
- `/app/frontend/src/pages/client/va-dashboard.tsx` - VA dedicated dashboard

## Data Flow

```
1. Partner calls POST /payments/danarapay/va/create
   ↓
2. DanaRapay API creates VA
   ↓
3. [NEW] Order record created in database with channel='VA_DANARAPAY'
   ↓
4. Client dashboard queries Order where channel='VA_DANARAPAY'
   ↓
5. VA appears in dashboard
```

## Important Notes

### For Existing VAs
VAs created before this fix will NOT appear in dashboard. Options:
1. Re-create VA via API (will save to database)
2. Manually insert Order records for existing VAs
3. Build sync tool to fetch VAs from DanaRapay and save to database

### Frontend Environment
Must set `NEXT_PUBLIC_API_URL` to backend API URL:
```
NEXT_PUBLIC_API_URL=http://your-backend-domain.com/api/v1
```

## Deployment Checklist
- [ ] Build backend: `tsc -p tsconfig.backend.json`
- [ ] Build frontend: `cd frontend && yarn build`
- [ ] Set `NEXT_PUBLIC_API_URL` environment variable
- [ ] Restart services
- [ ] Test create VA via API
- [ ] Verify VA appears in `/client/va-dashboard`

## Next Tasks
- P0: Test dengan data VA baru (setelah fix)
- P1: Build sync tool untuk VA yang sudah ada
- P2: Create VA dari dashboard
