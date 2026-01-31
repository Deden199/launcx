# Launcx Payment Gateway - Product Requirements Document

## Project Overview

Launcx is a payment gateway platform supporting QRIS and Virtual Account (VA) payments for Indonesian merchants.

## Architecture: DanaRapay as Source of Truth

```
┌─────────────────────────────────────────────────────────────────────┐
│                           DanaRapay API                              │
│                    (Single Source of Truth)                          │
│                                                                      │
│  VA Callback:                    Disbursement Callback:              │
│  - settlement_status = WAITING   - code 000 = SUCCESS                │
│  - settlement_status = SUCCESS   - code 300 = FAILED                 │
└───────────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────────┐
│                    launcx-core (Main Application)                   │
│                                                                      │
│  CALLBACK HANDLERS (status only, NO balance changes):               │
│  • danarapayVaCallback → updates Order.status, Order.settlementStatus│
│  • danarapayDisbursementCallback → updates WithdrawRequest.status   │
│                                                                      │
│  LEDGER SERVICE (balance changes):                                  │
│  • processOrderSettlement() → credits balance for SETTLED orders    │
│  • processWithdrawalBalanceDeduction() → debits balance for SUCCESS │
│                                                                      │
│  DASHBOARD:                                                          │
│  • Shows status based on DanaRapay state                            │
│  • Balance reflects only SETTLED transactions                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## State Flow: VA (Inbound)

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   VA Created     │───>│  Payment Detected│───>│    Settled       │
│  status: PENDING │    │  status: PAID    │    │  status: SETTLED │
│                  │    │  settlement:     │    │  settlement:     │
│                  │    │    WAITING       │    │    SUCCESS       │
│  balance: 0      │    │  balance: 0      │    │  balance: +amt   │
└──────────────────┘    └──────────────────┘    └──────────────────┘
        │                       │                        │
        │               DanaRapay Callback 1      DanaRapay Callback 2
        │               settlement_status=WAITING settlement_status=SUCCESS
        │                       │                        │
        └───────────────────────┴────────────────────────┘
                         Ledger processes SETTLED → balance credited
```

**Key Rules:**
- Callback 1 (WAITING): Order status = PAID, balance NOT changed
- Callback 2 (SUCCESS): Order status = SETTLED, ledger credits balance
- Balance ONLY increases when `status = SETTLED`

---

## State Flow: Withdrawal (Outbound)

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Withdrawal       │───>│   Processing     │───>│   Completed      │
│ Requested        │    │                  │    │                  │
│ status: PENDING  │    │ status: PROCESSING│   │ status: COMPLETED│
│ balance: no chg  │    │ balance: no chg  │    │ balance: -amt    │
└──────────────────┘    └──────────────────┘    └──────────────────┘
        │                       │                        │
        │               DanaRapay Callback        DanaRapay Callback
        │               code 101 (In Progress)   code 000 (Success)
        │                       │                        │
        └───────────────────────┴────────────────────────┘
                         Ledger processes COMPLETED → balance debited
```

**Key Rules:**
- Withdrawal created: status = PENDING, balance NOT changed
- DanaRapay callback determines final status
- Balance ONLY decreases when `status = COMPLETED` (DanaRapay SUCCESS)

---

## Files Modified/Created

### New Files
- `/app/src/service/ledger.service.ts` - Balance management based on DanaRapay status

### Modified Files
- `/app/src/controller/danarapayVa.controller.ts`
  - Status mapping from DanaRapay settlement_status
  - Callback only updates status, triggers ledger for SETTLED
  - Added disbursement callback handler
  
- `/app/src/controller/clientDashboard.controller.ts`
  - Metrics reflect DanaRapay status (waitingSettlement, settled)
  - VA stats show settlement status breakdown
  
- `/app/src/prisma/schema.prisma`
  - Order: Added `ledgerProcessed`, `ledgerProcessedAt`
  - WithdrawRequest: Added `balanceDeducted`, `balanceDeductedAt`, `balanceRefunded`, `disbursementPayload`

- `/app/src/route/danarapay.callback.routes.ts`
  - Added `/disbursement/callback` endpoint

---

## API Response Changes

### GET /api/v1/client/dashboard

```json
{
  "balance": 1500000,              // Only from SETTLED transactions
  "totalWaitingSettlement": 250000, // PAID status, waiting DanaRapay settlement
  "totalSettlement": 1200000,      // SETTLED status, in balance
  
  "vaStats": {
    "created": 45,
    "pending": 3,                  // Waiting payment
    "waitingSettlement": 5,        // PAID, waiting DanaRapay settlement
    "settled": 35,                 // SETTLED, in balance
    "expired": 2
  },
  
  "withdrawalStats": {
    "pending": 2,                  // Waiting DanaRapay
    "completed": 15,               // DanaRapay SUCCESS
    "failed": 1                    // DanaRapay FAILED
  }
}
```

---

## Backward Compatibility

1. **Existing SETTLED/SUCCESS transactions** - Already in balance, `ledgerProcessed` defaults to true
2. **New transactions** - Follow new flow with ledger tracking
3. **Migration not required** - New fields default appropriately

---

## Callback Endpoints

### VA Callback
`POST /api/v1/payments/danarapay/va/callback`
- Updates Order.status and Order.settlementStatus
- Triggers ledger for SETTLED status

### Disbursement Callback  
`POST /api/v1/payments/danarapay/disbursement/callback`
- Updates WithdrawRequest.status
- Triggers ledger for COMPLETED status

---

## Environment Configuration

### danarapay-router/.env (if using router)
```bash
CALLBACK_SECRET_TOKEN=<token>
DANARAPAY_IP_WHITELIST=103.150.60.52,103.150.60.53
```

---

Last Updated: 2025-01-31
