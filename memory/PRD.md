# PRD - Client Dashboard dengan VA DanaRapay (Terpisah)

## Original Problem Statement
Sesuaikan client dashboard agar menampilkan juga data dari VA DanaRapay agar mereka bisa monitor juga transaksi di danarapay.

## User Requirements (Final)
- Dashboard QRIS dan VA DanaRapay dipisah menjadi 2 halaman terpisah untuk lebih spesifik
- Masing-masing dashboard punya fitur lengkap (stats, filters, transactions, export)

## Architecture

### Halaman Dashboard

| Route | Halaman | Fungsi |
|-------|---------|--------|
| `/client/dashboard` | Dashboard QRIS | Monitor transaksi QRIS (existing) |
| `/client/va-dashboard` | Dashboard VA DanaRapay | Monitor transaksi & VA aktif DanaRapay |

### Backend Endpoints

| Endpoint | Handler | Fungsi |
|----------|---------|--------|
| `GET /client/dashboard` | `getClientDashboard` | Data dashboard QRIS (filter channel=QRIS) |
| `GET /client/va-dashboard` | `getVaDashboard` | Data VA transactions + stats |
| `GET /client/va-active` | `getActiveVaList` | List VA yang masih menunggu pembayaran |
| `GET /client/dashboard/export` | `exportClientTransactions` | Export transactions ke Excel |

### Frontend Files
- `/app/frontend/src/pages/client/dashboard.tsx` - Dashboard QRIS
- `/app/frontend/src/pages/client/va-dashboard.tsx` - Dashboard VA DanaRapay

### Backend Files Modified
- `/app/src/controller/clientDashboard.controller.ts` - Added `getVaDashboard`, `getActiveVaList`
- `/app/src/route/client/web.routes.ts` - Added routes

## Features Implemented (Jan 30, 2026)

### Dashboard QRIS (`/client/dashboard`)
- [x] Stats: Transactions, Pending Settlement, Total Settlement
- [x] Filters: Date range, Status, Search
- [x] Transaction list dengan pagination
- [x] Export to Excel
- [x] Link ke VA Dashboard

### Dashboard VA DanaRapay (`/client/va-dashboard`)
- [x] Stats Cards: Total VA, Pending, Success, Expired, Total Amount, Total Paid
- [x] Tab "Transaksi VA": List transaksi dengan filter (date, status, bank, search)
- [x] Tab "VA Aktif": Grid cards VA yang menunggu pembayaran
- [x] Filters: Rentang waktu, Status, Bank VA, Search
- [x] Export to Excel
- [x] Link kembali ke Dashboard QRIS

## Deployment Requirements
1. Set environment variable `NEXT_PUBLIC_API_URL` di frontend ke URL backend API
   Contoh: `NEXT_PUBLIC_API_URL=http://your-api-domain.com/api/v1`
2. Pastikan backend sudah di-build dengan `tsc -p tsconfig.backend.json`
3. Restart services

## Next Tasks
- P1: Test dengan data VA real dari DanaRapay
- P1: Create VA dari dashboard (opsional, user request next phase)
- P2: Real-time notification saat ada pembayaran VA masuk

## Bank VA Supported
| Code | Bank |
|------|------|
| 002 | BRI |
| 008 | Mandiri |
| 009 | BNI |
| 013 | Permata |
| 022 | CIMB |
