# PRD - Client Dashboard VA DanaRapay Integration

## Original Problem Statement
Sesuaikan client dashboard agar menampilkan juga data dari VA DanaRapay agar mereka bisa monitor juga transaksi di danarapay.

## User Requirements Gathered
1. **Data VA yang ditampilkan**: Semua (list transaksi VA, summary stats, list VA aktif)
2. **Cara tampil**: Digabung dengan tabel transaksi existing + section VA Aktif terpisah
3. **Filter tambahan**: Filter by channel/provider + filter by bank VA
4. **Fitur tambahan**: Monitor transaksi saja (create VA opsional next phase)

## Architecture

### Backend Changes (`/app/src/controller/clientDashboard.controller.ts`)
- Added channel filter (`QRIS` / `VA_DANARAPAY`)
- Added bank code filter for VA transactions
- Added VA stats aggregation (created, pending, success, expired, totalAmount)
- Added VA bank mapping (BRI, Mandiri, BNI, Permata, CIMB)
- Added `channel`, `vaNumber`, `bankCode`, `bankName` fields to transaction response
- Added new endpoint: `GET /api/v1/client/va-active` for active VA monitoring

### Frontend Changes (`/app/frontend/src/pages/client/dashboard.tsx`)
- Added VA DanaRapay stats card (Pending, Success, Expired, Total)
- Added Channel filter dropdown (All Channels / QRIS / VA DanaRapay)
- Added Bank VA filter dropdown (appears when VA DanaRapay selected)
- Added columns: Channel, VA/Bank to transaction table
- Added VA Aktif (Monitoring) collapsible section with VA cards

### Routes (`/app/src/route/client/web.routes.ts`)
- Added `GET /va-active` endpoint

## What's Been Implemented (Jan 30, 2026)
- [x] Backend: Channel and bank code filters
- [x] Backend: VA stats aggregation
- [x] Backend: Active VA list endpoint
- [x] Frontend: VA DanaRapay stats card
- [x] Frontend: Channel filter dropdown
- [x] Frontend: Bank VA filter (conditional)
- [x] Frontend: Transaction table with Channel/VA columns
- [x] Frontend: VA Aktif monitoring section
- [x] TypeScript compilation successful

## User Personas
- **Client/Merchant**: Users who need to monitor all their payment transactions (QRIS + VA) in one unified dashboard

## Core Requirements (Static)
- Single dashboard view for all payment channels
- Filter by channel (QRIS vs VA DanaRapay)
- Filter by VA bank (BRI, Mandiri, BNI, Permata, CIMB)
- VA statistics summary
- Active VA monitoring

## Prioritized Backlog
### P0 (Done)
- [x] Transaction list with channel/VA data
- [x] VA stats summary
- [x] Channel & bank filters
- [x] Active VA monitoring section

### P1 (Next Phase)
- [ ] Create VA from dashboard
- [ ] Manual "Refresh VA Status" button
- [ ] Export VA transactions to Excel (separate from QRIS)

### P2 (Future)
- [ ] VA payment notifications
- [ ] VA analytics charts
- [ ] Bulk VA creation

## Next Tasks
1. Deploy to production with proper environment variables
2. Test with real VA transactions
3. Consider adding Create VA feature for merchants
