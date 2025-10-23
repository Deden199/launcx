# ING1 Provider Documentation

## Overview

ING1 is a payment gateway provider integrated into the Launcx platform for both **Payment (Payin)** and **Withdrawal (Payout)** operations.

**Provider Name:** `ing1`
**Status:** Active
**Supported Operations:** Payment Collection, Bank Transfer Withdrawal

---

## Table of Contents

1. [Configuration](#configuration)
2. [Payment Operations](#payment-operations)
3. [Withdrawal Operations](#withdrawal-operations)
4. [Callbacks & Webhooks](#callbacks--webhooks)
5. [Status Mapping](#status-mapping)
6. [Error Handling](#error-handling)
7. [Testing](#testing)

---

## Configuration

### Environment Variables

Required environment variables for ING1 integration:

```bash
# ING1 Provider Configuration (not shown in current env.txt, should be in sub_merchant credentials)
ING1_BASE_URL=https://api.ing1.com
ING1_EMAIL=your-email@example.com
ING1_PASSWORD=your-password
ING1_PRODUCT_CODE=QRIS
ING1_CALLBACK_URL=https://launcx.com/api/v1/payment/ing1/callback
ING1_PERMANENT_TOKEN=your-permanent-token
ING1_MERCHANT_ID=your-merchant-id
ING1_API_VERSION=v2
```

### Database Configuration

ING1 credentials are stored in the `sub_merchant` collection with provider type `"ing1"`:

```typescript
{
  id: "sub_merchant_id",
  name: "ING1 Wallet",
  provider: "ing1",
  credentials: {
    baseUrl: "https://api.ing1.com",
    email: "merchant@example.com",
    password: "encrypted_password",
    productCode: "QRIS",
    callbackUrl: "https://launcx.com/api/v1/payment/ing1/callback",
    permanentToken: "token_here",
    merchantId: "merchant_id",
    apiVersion: "v2"
  }
}
```

### Partner Client Configuration

To use ING1 as default provider:

```typescript
{
  partnerClient: {
    id: "client_id",
    defaultProvider: "ing1",  // Set this to use ING1
    forceSchedule: null,       // or "weekday" / "weekend"
    // ... other fields
  }
}
```

---

## Payment Operations

### Create Payment Transaction

**Flow:**
1. Client creates transaction via API
2. System selects active ING1 sub-merchant
3. ING1 generates QR code or payment link
4. Customer completes payment
5. ING1 sends callback
6. System updates order status

**Code Reference:** `src/controller/payment.ts:33-184`

**API Endpoint:** `POST /api/v1/transactions`

**Request Example:**
```json
{
  "merchantName": "hilogate",
  "price": 50000,
  "playerId": "player123",
  "flow": "embed",
  "paymentChannel": "qris"
}
```

**ING1 Specific Parameters:**
- `paymentChannel`: Payment method (e.g., "qris", "va")
- `expiredTime`: Transaction timeout in seconds

### Payment Callback

**Endpoint:** `GET /api/v1/payment/ing1/callback`

**Callback Handler:** `src/controller/payment.ts:407-517`

**Query Parameters Received:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `client_reff` / `clientReff` | Your order ID | `"order_123"` |
| `reff` / `reference` | ING1 reference | `"ING123456"` |
| `rc` / `RC` | Response code | `0` (success) |
| `status` | Transaction status | `"PAID"`, `"FAILED"` |
| `total` / `amount` | Transaction amount | `50000` |
| `paid_at` | Payment time | `"2025-10-19 10:30:00"` |
| `settlement_time` | Settlement time | `"2025-10-19 11:00:00"` |
| `expired_at` | Expiration time | `"2025-10-19 12:00:00"` |

**Callback Processing:**
1. Extract and normalize query parameters
2. Store in `transaction_callback` table
3. Cancel fallback timer
4. Process status update via `processIng1Update()`
5. Return HTTP 200 to acknowledge

---

## Withdrawal Operations

### Withdrawal Flow

**Two-Phase Process:**
1. **Inquiry Phase:** Validate account and get withdrawal reference
2. **Payment Phase:** Execute the withdrawal using the reference

**Code Reference:** `src/controller/withdrawals.controller.ts:1178-1702`

### 1. Account Validation (Inquiry)

**API Endpoint:** `POST /api/v1/client/withdrawals/validate`

**Request:**
```json
{
  "account_number": "1234567890",
  "bank_code": "014",
  "sourceProvider": "ing1",
  "amount": 50000
}
```

**ING1 Client Method:** `cashoutInquiry()`

**Request to ING1:**
```typescript
{
  bankCode: "014",
  accountNumber: "1234567890",
  amount: 50000,
  clientReff: "inq-1729335000000",
  merchantId: "merchant_id"
}
```

**Response Fields:**
```typescript
{
  status: "PAID" | "FAILED",
  rc: 0,  // Response code
  reff: "ING_REF_123",  // ING1 reference for payment
  accountName: "JOHN DOE",
  accountNumber: "1234567890",
  bankCode: "014",
  bankName: "Bank Central Asia",
  fee: 2500,
  message: "Success"
}
```

### 2. Create Withdrawal Request

**API Endpoint:** `POST /api/v1/client/withdrawals`

**Request:**
```json
{
  "subMerchantId": "sub_merchant_001",
  "sourceProvider": "ing1",
  "account_number": "1234567890",
  "bank_code": "014",
  "amount": 100000,
  "account_name": "JOHN DOE",
  "bank_name": "Bank Central Asia",
  "otp": "123456"
}
```

**Processing Steps:**
1. Validate account via inquiry
2. Create withdrawal record with status `PENDING`
3. Deduct balance from wallet
4. Call `cashoutPayment()` with ING1 reference
5. Schedule fallback status check
6. Update withdrawal record with result

**ING1 Client Method:** `cashoutPayment()`

**Request to ING1:**
```typescript
{
  reff: "ING_REF_123",  // From inquiry
  clientReff: "wd-1729335000000",
  amount: 95000,  // Net amount after fees
  merchantId: "merchant_id"
}
```

### 3. Withdrawal Callback

**Endpoint:** `GET /api/v1/withdrawals/ing1/callback`

**Callback Handler:** `src/controller/withdrawals.controller.ts:834-915`

**Query Parameters:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `client_reff` / `clientReff` | Withdrawal ref ID | `"wd-1729335000000"` |
| `reff` / `reff_id` | ING1 reference | `"ING_WD_123"` |
| `rc` / `RC` | Response code | `0` |
| `status` / `STATUS` | Status text | `"SUCCESS"`, `"FAILED"` |
| `fee` / `total_fee` | Withdrawal fee | `2500` |
| `completed_at` | Completion time | `"2025-10-19 11:00:00"` |

**Status Processing:**
```typescript
const mapIng1ToDisbursement = (rc, statusText) => {
  const normalized = mapIng1Status(rc, statusText)
  if (normalized === 'PAID') return 'COMPLETED'
  if (normalized === 'PENDING') return 'PENDING'
  return 'FAILED'
}
```

### 4. Withdrawal Status Check (Fallback)

**Purpose:** Automatically check pending withdrawals in case callback is missed

**Endpoint:** `POST /api/v1/internal/query-pending-ing1-withdrawals`

**Code Reference:** `src/controller/withdrawals.controller.ts:446-535`

**Process:**
1. Query all withdrawals with status `PENDING` and provider `ing1`
2. For each withdrawal:
   - Call ING1 `listCashoutHistory()` API
   - Match by `paymentGatewayId` (reff) or `refId` (clientReff)
   - Update status based on response
   - Refund balance if failed
   - Update fee and completion time

**ING1 Client Method:** `listCashoutHistory()`

**Request:**
```typescript
{
  reff: "ING_WD_123",  // Optional
  clientReff: "wd-1729335000000"  // Optional
}
```

**Response:**
```typescript
{
  rc: 0,
  histories: [
    {
      reff: "ING_WD_123",
      clientReff: "wd-1729335000000",
      status: "SUCCESS",
      fee: 2500,
      paidAt: "2025-10-19 11:00:00"
    }
  ],
  raw: { /* original response */ }
}
```

---

## Callbacks & Webhooks

### Payment Callback URL Structure

```
GET {BASE_URL}/api/v1/payment/ing1/callback
  ?client_reff={orderId}
  &reff={ing1_reference}
  &rc={response_code}
  &status={status}
  &total={amount}
  &paid_at={timestamp}
```

### Withdrawal Callback URL Structure

```
GET {BASE_URL}/api/v1/withdrawals/ing1/callback
  ?client_reff={refId}
  &reff={ing1_reference}
  &rc={response_code}
  &status={status}
  &fee={fee_amount}
  &completed_at={timestamp}
```

### Callback Security

**ING1 callbacks use query parameters** (no signature verification in current implementation)

**Idempotency:** Callbacks are stored in `transaction_callback` table to prevent duplicate processing

---

## Status Mapping

### ING1 Response Codes (rc)

| Code | Meaning | Mapped Status |
|------|---------|---------------|
| `0` | Success | `PAID` |
| `68` | Pending | `PENDING` |
| `99` | Failed | `FAILED` |
| Other | Error | `FAILED` |

**Code Reference:** `src/service/ing1Status.ts:mapIng1Status()`

### Payment Status Flow

```
PENDING → PAID → (settlement) → SUCCESS/DONE/SETTLED
        ↓
      EXPIRED
      FAILED
```

### Withdrawal Status Flow

```
PENDING → COMPLETED
        ↓
      FAILED (balance refunded)
```

---

## Error Handling

### Common Errors

**Payment Errors:**
- `Missing client_reff` - Order ID not provided
- `Order not found` - Invalid order ID
- `Invalid signature` - (Not applicable for ING1, uses query params)

**Withdrawal Errors:**
- `Missing client reference` - Withdrawal ref ID not provided
- `Withdrawal not found` - Invalid withdrawal ref ID
- `Account inquiry failed` - Invalid bank account or insufficient info
- `Withdrawal failed` - ING1 rejected the transaction
- `Saldo tidak mencukupi` - Insufficient wallet balance
- `Minimum withdraw Rp X` - Below minimum limit
- `Maximum withdraw Rp X` - Above maximum limit
- `OTP tidak valid` - Invalid 2FA code

### Error Response Format

```json
{
  "error": "Error message here",
  "status": "invalid",
  "rc": 99
}
```

### Automatic Retry & Fallback

**Withdrawal Fallback:** `src/service/ing1WithdrawalFallback.ts`

- Automatically scheduled after withdrawal creation
- Checks status after configured delay
- Updates status if callback was missed
- Refunds balance on failure

**Payment Fallback:** `src/service/ing1Fallback.ts`

- Scheduled after payment creation
- Polls status until completion or timeout
- Cancels on callback receipt

---

## Testing

### Test Credentials

Use sandbox/staging credentials in `sub_merchant.credentials`:

```typescript
{
  baseUrl: "https://staging-api.ing1.com",
  email: "test@example.com",
  password: "test_password",
  merchantId: "TEST_MERCHANT",
  permanentToken: "test_token",
  apiVersion: "v2"
}
```

### Test Bank Accounts

Common test accounts (check with ING1 for actual test data):

| Bank Code | Account Number | Expected Result |
|-----------|----------------|-----------------|
| `014` | `1111111111` | Success |
| `014` | `9999999999` | Failure |
| `002` | `1234567890` | Pending |

### Simulating Callbacks

**Payment Callback:**
```bash
curl "http://localhost:5000/api/v1/payment/ing1/callback?client_reff=order_123&reff=TEST_REF&rc=0&status=PAID&total=50000&paid_at=2025-10-19%2010:30:00"
```

**Withdrawal Callback:**
```bash
curl "http://localhost:5000/api/v1/withdrawals/ing1/callback?client_reff=wd-123&reff=TEST_REF&rc=0&status=SUCCESS&fee=2500&completed_at=2025-10-19%2011:00:00"
```

### Manual Status Check

Query pending withdrawals:
```bash
curl -X POST http://localhost:5000/api/v1/internal/query-pending-ing1-withdrawals
```

---

## File References

### Core Implementation Files

| File | Purpose |
|------|---------|
| `src/service/ing1Client.ts` | ING1 API client implementation |
| `src/service/ing1Status.ts` | Status mapping utilities |
| `src/service/ing1Fallback.ts` | Payment fallback mechanism |
| `src/service/ing1WithdrawalFallback.ts` | Withdrawal fallback mechanism |
| `src/controller/payment.ts:407-517` | Payment callback handler |
| `src/controller/withdrawals.controller.ts:834-915` | Withdrawal callback handler |
| `src/controller/withdrawals.controller.ts:446-535` | Pending withdrawal query |
| `src/controller/withdrawals.controller.ts:1178-1702` | Withdrawal creation |

### Configuration Files

| File | Purpose |
|------|---------|
| `src/prisma/schema.prisma` | Database schema |
| `src/config.ts` | Application configuration |

### Route Files

| File | Endpoints |
|------|-----------|
| `src/route/payment.callback.routes.ts` | Payment callbacks |
| `src/route/withdrawals.routes.ts` | Withdrawal endpoints |
| `src/route/internal.routes.ts` | Internal/admin endpoints |

---

## Best Practices

1. **Always validate accounts** before creating withdrawals
2. **Store ING1 references** (reff) for tracking and debugging
3. **Monitor fallback jobs** to ensure status updates
4. **Handle idempotency** - check for existing callbacks
5. **Log all ING1 responses** for troubleshooting
6. **Implement retry logic** for network failures
7. **Configure proper timeouts** to prevent hanging requests
8. **Monitor wallet balances** to prevent negative balances
9. **Test with small amounts** before production
10. **Set up alerts** for failed transactions

---

## Support & Troubleshooting

### Common Issues

**Issue:** Payment not updating after customer pays
- **Check:** Callback URL is reachable
- **Check:** Fallback service is running
- **Action:** Manually query transaction status

**Issue:** Withdrawal stuck in PENDING
- **Check:** ING1 callback was received
- **Check:** Fallback has run
- **Action:** Run `/query-pending-ing1-withdrawals`

**Issue:** Balance not refunded on failed withdrawal
- **Check:** Withdrawal status in database
- **Check:** Balance transaction logs
- **Action:** Manually refund via admin panel

### Debug Endpoints

```bash
# Query all pending ING withdrawals
POST /api/v1/internal/query-pending-ing1-withdrawals

# Retry specific withdrawal
POST /api/v1/withdrawals/:id/retry
```

### Logs

Monitor these log patterns:
- `[ING1 Callback]` - Callback processing
- `[ing1WithdrawalCallback]` - Withdrawal callback
- `[queryPendingIng1Withdrawals]` - Status check
- `[requestWithdraw]` - Withdrawal creation

---

**Last Updated:** October 2025
**Documentation Version:** 1.0
**Provider Version:** ING1 API v2
