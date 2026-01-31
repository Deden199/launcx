# STAGING DEPLOYMENT GUIDE
## Launcx Core - DanaRapay Integration

---

## 1. Prerequisites

- Node.js 18+ 
- MongoDB 5+ (with replica set enabled for transactions)
- Redis (optional, for caching)

---

## 2. Environment Setup

### Copy environment template:
```bash
cp .env.staging.example .env
```

### Required Environment Variables:
```bash
# Database
DATABASE_URL=mongodb://localhost:27017/launcx

# Application
PORT=8001
NODE_ENV=staging
BASE_URL=https://your-staging-domain.com
JWT_SECRET=<generate-secure-secret>

# DanaRapay Credentials (get from DanaRapay Dashboard)
DANARAPAY_BASE_URL=https://api-stg.danarapay.com
DANARAPAY_USERNAME=<your-username>
DANARAPAY_API_KEY=<your-api-key>

# Callback Security (REQUIRED - generate secure token)
CALLBACK_SECRET_TOKEN=<generate-min-32-char-token>

# Optional: IP Whitelist (comma-separated)
DANARAPAY_IP_WHITELIST=
```

### Generate Secure Tokens:
```bash
# Generate CALLBACK_SECRET_TOKEN
openssl rand -base64 32

# Generate JWT_SECRET
openssl rand -hex 32
```

---

## 3. Database Migration

### If using Prisma (recommended):
```bash
# Generate Prisma client
npx prisma generate

# Push schema to database (creates collections and indexes)
npx prisma db push
```

### New Fields Added (since last release):
```
Order:
  - ledgerProcessed: Boolean (tracks if settlement credited)
  - ledgerProcessedAt: DateTime

WithdrawRequest:
  - balanceDeducted: Boolean (tracks if withdrawal debited)
  - balanceDeductedAt: DateTime
  - balanceRefunded: Boolean (tracks if failed withdrawal refunded)
  - balanceRefundedAt: DateTime
  - disbursementPayload: Json (stores DanaRapay trx_id + audit)
```

---

## 4. Build & Run

### Install dependencies:
```bash
yarn install
# or
npm install
```

### Build TypeScript:
```bash
yarn build
# or
npm run build
```

### Start application:
```bash
# Using node directly
node dist/app.js

# Using PM2 (recommended for production)
pm2 start dist/app.js --name launcx-core

# Using yarn script
yarn start
```

### Verify running:
```bash
curl http://localhost:8001/api/v1/health
# Should return 404 (no health endpoint) but server responds
```

---

## 5. DanaRapay Dashboard Configuration

### Set Callback URLs in DanaRapay Dashboard:

| Type | URL |
|------|-----|
| VA Callback | `https://your-staging-domain.com/api/v1/payments/danarapay/va/callback` |
| Disbursement Callback | `https://your-staging-domain.com/api/v1/payments/danarapay/disbursement/callback` |

### Set Callback Token:
- Use the same value as `CALLBACK_SECRET_TOKEN` in your .env
- This token will be sent in `X-Callback-Token` header

---

## 6. E2E Test Scripts

### Run Ledger Gates Test (Gates 1-3):
```bash
npx ts-node backend/tests/e2e-ledger-gates.ts
```

Expected output:
```
✅ Gate 1: VA Settlement Single Credit (Atomic)
✅ Gate 1 & 2: Withdrawal Flow DanaRapay (Atomic + Idempotent)
✅ Gate 2: Negative Balance Guard
✅ Gate 3: Legacy Provider Refund (Idempotent)
✅ Gate 3: DanaRapay No Refund (Correct Behavior)
Total: 5 passed, 0 failed
```

### Run DanaRapay E2E Test:
```bash
npx ts-node backend/tests/e2e-gap2-danarapay.ts
```

Expected output:
```
✅ DanaRapay Withdrawal - No Debit on Create
✅ DanaRapay Callback - Debit on SUCCESS
✅ DanaRapay Duplicate Callback - Idempotent
Total: 3 passed, 0 failed
```

---

## 7. Manual Callback Tests

### Test callback security (without token - should fail):
```bash
curl -X POST "https://your-staging-domain.com/api/v1/payments/danarapay/va/callback" \
  -H "Content-Type: application/json" \
  -d '{"va_number": "test", "amount": 10000, "settlement_status": "SUCCESS"}'

# Expected: HTTP 401 {"success":false,"error":"Missing callback token","code":"TOKEN_MISSING"}
```

### Test callback security (with token - should succeed):
```bash
curl -X POST "https://your-staging-domain.com/api/v1/payments/danarapay/va/callback" \
  -H "Content-Type: application/json" \
  -H "X-Callback-Token: YOUR_CALLBACK_SECRET_TOKEN" \
  -d '{"va_number": "test", "amount": 10000, "settlement_status": "SUCCESS"}'

# Expected: HTTP 200 {"success":true,"message":"Callback received"}
```

---

## 8. E2E Real DanaRapay Checklist

### VA Flow:
- [ ] Create VA → get VA number
- [ ] Make payment to VA
- [ ] Callback WAITING received → Order status = PAID, balance unchanged
- [ ] Callback SUCCESS received → Order status = SETTLED, balance +amount (once)
- [ ] Send duplicate SUCCESS callback → balance unchanged (idempotent)

### Withdrawal Flow:
- [ ] Create withdrawal (DanaRapay) → status = PENDING, balance unchanged
- [ ] Verify `disbursementPayload.danarapay_trx_id` saved in DB
- [ ] Callback PENDING (301) → status update only, balance unchanged
- [ ] Callback SUCCESS (000) → status = COMPLETED, balance -amount (once)
- [ ] Send duplicate SUCCESS callback → balance unchanged (idempotent)

### Security:
- [ ] Callback without token → HTTP 401
- [ ] Callback with wrong token → HTTP 401
- [ ] Callback with correct token → HTTP 200

### Edge Cases:
- [ ] Insufficient balance withdrawal → should fail, balance not negative
- [ ] Server restart → pending transactions resume correctly

---

## 9. Troubleshooting

### Callback returns 500 SECURITY_MISCONFIGURED:
- `CALLBACK_SECRET_TOKEN` is not set in .env
- Fix: Set the token and restart server

### MongoDB transaction errors:
- MongoDB must run as replica set for Prisma transactions
- Fix: Initialize replica set:
```bash
mongosh --eval "rs.initiate()"
```

### Callbacks not received:
- Check DanaRapay Dashboard callback URL is correct
- Check firewall allows incoming requests from DanaRapay IPs
- Check `X-Callback-Token` header matches

---

## 10. Files Reference

| File | Purpose |
|------|---------|
| `/src/service/ledger.service.ts` | Atomic balance operations |
| `/src/service/danarapayClient.ts` | DanaRapay API client |
| `/src/middleware/callbackSecurity.ts` | Callback token verification |
| `/src/controller/danarapayVa.controller.ts` | VA & Disbursement callbacks |
| `/src/controller/withdrawals.controller.ts` | Withdrawal creation |
| `/src/route/danarapay.callback.routes.ts` | Callback routes |
| `/backend/tests/e2e-ledger-gates.ts` | Ledger gates test |
| `/backend/tests/e2e-gap2-danarapay.ts` | DanaRapay E2E test |

---

Last Updated: 2026-01-31
