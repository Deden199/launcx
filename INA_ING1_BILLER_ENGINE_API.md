# INA Payment (ING1) - Biller Engine API Documentation

**Status**: Based on ING1 Biller Engine API v2
**Date**: 2025-10-22
**Important Note**: INA/ING1 ONLY accepts **QRIS** and **BANK TRANSFER** - NO other payment methods

---

## Quick Summary

| Capability | Supported | Notes |
|-----------|-----------|-------|
| **QRIS** | ✅ YES | Primary payment method (via Billers QRIS_DIRECT) |
| **Bank Transfer** | ✅ YES | Via withdrawal/cashout endpoints |
| **E-Wallet** | ❌ NO | Not supported |
| **Virtual Account (VA)** | ❌ NO | Not supported |
| **Credit/Debit Card** | ❌ NO | Not supported |

---

## Payment Methods

### 1. QRIS Payment (Cash-In / Cashin)

**Product Code**: `QRIS_DIRECT` or `QRIS`

INA supports QRIS payments through the Biller Engine API. Customers scan a QR code to pay using any e-wallet or bank app.

#### Request Example

```bash
curl -X POST 'https://api.ing1.com/v2/transaction/cashin/create' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "product_code": "QRIS_DIRECT",
    "amount": 50000,
    "client_reff": "order_20251022_001",
    "merchant_id": "YOUR_MERCHANT_ID",
    "return_url": "https://yourdomain.com/payment-callback",
    "expiry_time": "01:00:00",
    "remark": "Payment for order #12345"
  }'
```

**Required Parameters:**
- `product_code` (string): `"QRIS_DIRECT"` or `"QRIS"`
- `amount` (number): Amount in IDR
- `client_reff` (string): Your unique order/transaction reference
- `merchant_id` (string): Your ING1 merchant ID

**Optional Parameters:**
- `return_url` (string): Callback URL for payment notification
- `expiry_time` (string): Expiration duration (format: "HH:MM:SS", default: "23:59:59")
- `remark` (string): Transaction description/note

#### Response Example

```json
{
  "rc": 0,
  "message": "Success",
  "status": "PAID",
  "reff": "ING20251022000001",
  "client_reff": "order_20251022_001",
  "product_code": "QRIS_DIRECT",
  "data": {
    "payment_url": "https://portal.ing1.com/payment/qris?reff=ING20251022000001",
    "content": "00020101021126670016com.midtrans.qris01051234567890215406123450520418605802ID5913LAUNCX6009JAKARTA62130811123456321234567890639150",
    "expired_at": "2025-10-23 12:30:45"
  }
}
```

**Response Fields:**
- `rc` (number): Response code (0=success)
- `status` (string): `"PAID"`, `"PENDING"`, or `"FAILED"`
- `reff` (string): ING1 transaction reference (use for status checks)
- `data.payment_url` (string): Direct payment URL
- `data.content` (string): QR code content (EMV Standard)
- `data.expired_at` (string): Payment expiration timestamp

---

### 2. Bank Transfer Payment (Cash-Out / Payout)

**Endpoints**: `cashout/inquiry` → `cashout/payment`

INA supports bank transfers via a two-step process:
1. **Inquiry** - Validate the bank account
2. **Payment** - Execute the withdrawal

#### Step 1: Account Inquiry (Validation)

```bash
curl -X POST 'https://api.ing1.com/v2/transaction/cashout/inquiry' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "bank_code": "014",
    "account_no": "1234567890",
    "amount": 50000,
    "client_reff": "withdrawal_20251022_001",
    "merchant_id": "YOUR_MERCHANT_ID",
    "customer_name": "JOHN DOE"
  }'
```

**Required Parameters:**
- `bank_code` (string): Bank code (see table below)
- `account_no` (string): Destination bank account number
- `amount` (number): Withdrawal amount in IDR
- `client_reff` (string): Your unique withdrawal reference
- `merchant_id` (string): Your ING1 merchant ID

**Optional Parameters:**
- `customer_name` (string): Account holder name
- `remark` (string): Transaction note

#### Response Example (Inquiry)

```json
{
  "rc": 0,
  "message": "Success",
  "status": "PAID",
  "reff": "ING20251022WD00001",
  "client_reff": "withdrawal_20251022_001",
  "data": {
    "bank_code": "014",
    "bank_name": "Bank Central Asia",
    "account_number": "1234567890",
    "account_name": "JOHN DOE",
    "amount": 50000,
    "fee": 2500
  }
}
```

**Important**: The `reff` returned here is used for the payment step.

#### Step 2: Execute Bank Transfer (Payment)

```bash
curl -X POST 'https://api.ing1.com/v2/transaction/cashout/payment' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "reff": "ING20251022WD00001",
    "client_reff": "withdrawal_20251022_001",
    "amount": 47500,
    "merchant_id": "YOUR_MERCHANT_ID",
    "otp": "123456"
  }'
```

**Required Parameters:**
- `reff` (string): Reference from inquiry response
- `client_reff` (string): Your withdrawal reference (must match inquiry)
- `merchant_id` (string): Your ING1 merchant ID

**Optional Parameters:**
- `amount` (number): Payment amount (may differ from inquiry if adjusted for fees)
- `otp` (string): One-time password if required

#### Response Example (Payment)

```json
{
  "rc": 0,
  "message": "Success",
  "status": "PAID",
  "reff": "ING20251022WD00001",
  "client_reff": "withdrawal_20251022_001",
  "data": {
    "status": "SUCCESS",
    "amount": 47500,
    "fee": 2500,
    "completed_at": "2025-10-22 14:30:00"
  }
}
```

---

## Complete Integration Examples

### Full QRIS Flow (Launcx API)

```bash
# Create payment via Launcx
curl -X POST 'https://launcx.com/api/v1/transactions' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "merchantName": "ing1",
    "price": 50000,
    "playerId": "player_123",
    "paymentChannel": "qris",
    "customerEmail": "customer@example.com",
    "customerPhone": "081234567890",
    "transactionDescription": "Payment for order #12345"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "ORD_20251022_001",
    "checkoutUrl": "https://portal.ing1.com/payment/qris?reff=ING20251022000001",
    "qrPayload": "00020101021126670016com.midtrans.qris01051234567890...",
    "playerId": "player_123",
    "totalAmount": 50000,
    "expiredTs": "2025-10-23T12:30:00Z"
  }
}
```

### Full Bank Transfer Flow (Launcx API)

#### 1. Validate Account

```bash
curl -X POST 'https://launcx.com/api/v1/client/withdrawals/validate' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "account_number": "1234567890",
    "bank_code": "014",
    "sourceProvider": "ing1",
    "amount": 50000
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "VALID",
    "accountName": "JOHN DOE",
    "bankName": "Bank Central Asia",
    "fee": 2500,
    "netAmount": 47500
  }
}
```

#### 2. Create Withdrawal (Bank Transfer)

```bash
curl -X POST 'https://launcx.com/api/v1/client/withdrawals' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "subMerchantId": "SUB_MERCHANT_ID",
    "sourceProvider": "ing1",
    "account_number": "1234567890",
    "bank_code": "014",
    "amount": 50000,
    "account_name": "JOHN DOE",
    "bank_name": "Bank Central Asia"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "WD_20251022_001",
    "status": "PENDING",
    "amount": 50000,
    "fee": 2500,
    "netAmount": 47500,
    "bankName": "Bank Central Asia",
    "accountNumber": "****7890",
    "createdAt": "2025-10-22T10:00:00Z"
  }
}
```

---

## Supported Banks & Codes

| Code | Bank Name | Supported | Notes |
|------|-----------|-----------|-------|
| `002` | BRI (Bank Rakyat Indonesia) | ✅ | |
| `008` | Mandiri | ✅ | |
| `009` | BNI (Bank Negara Indonesia) | ✅ | |
| `010` | CIMB Niaga | ✅ | |
| `011` | OCBC NISP | ✅ | |
| `012` | Maybank | ✅ | |
| `013` | BCA Syariah | ✅ | |
| `014` | BCA (Bank Central Asia) | ✅ | Most common |
| `015` | HSBC | ✅ | |
| `016` | Danamon | ✅ | |
| `019` | Panin Bank | ✅ | |
| `020` | Bukopin | ✅ | |
| `023` | BTPN | ✅ | |
| `025` | Bank Indonesia | ❌ | Central bank, not for transfers |
| `028` | Astra Credit Companies | ✅ | |
| `031` | Citibank | ✅ | |
| `032` | UOB | ✅ | |
| `033` | MUFG Bank | ✅ | |
| `034` | Sumitomo Mitsui | ✅ | |
| `040` | Bank DBS | ✅ | |

---

## Status Codes & Mapping

### ING1 Response Codes (`rc`)

| Code | Status | Meaning |
|------|--------|---------|
| `0` | PAID | Success |
| `91` | PENDING | Processing/Awaiting |
| `98` | FAILED | Token expired (retry) |
| `99` | FAILED | General failure |

### Payment Status Lifecycle

```
PENDING (awaiting payment)
   ↓
PAID (payment received)
   ↓
SETTLED/SUCCESS (funds available)

Or error:
FAILED (payment rejected/expired)
EXPIRED (timeout)
```

### Withdrawal Status Lifecycle

```
PENDING (processing)
   ↓
COMPLETED (funds sent)

Or error:
FAILED (rejected - balance refunded)
```

---

## Callback Format

### Payment Callback

When a QRIS payment is completed, ING1 sends a callback to your `return_url`:

```
GET {return_url}?client_reff=order_20251022_001&reff=ING20251022000001&rc=0&status=PAID&total=50000&paid_at=2025-10-22%2010:30:00
```

**Parameters:**
- `client_reff`: Your order reference
- `reff`: ING1 transaction reference
- `rc`: Response code (0 = success)
- `status`: `PAID`, `PENDING`, or `FAILED`
- `total`: Paid amount
- `paid_at`: Payment timestamp

### Withdrawal Callback

```
GET {callback_url}?client_reff=withdrawal_20251022_001&reff=ING20251022WD00001&rc=0&status=SUCCESS&fee=2500&completed_at=2025-10-22%2014:30:00
```

**Parameters:**
- `client_reff`: Your withdrawal reference
- `reff`: ING1 transaction reference
- `rc`: Response code
- `status`: `SUCCESS` or `FAILED`
- `fee`: Withdrawal fee amount
- `completed_at`: Completion timestamp

---

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|-----------|
| `rc=99` | General error | Check parameters, check ING1 system status |
| `rc=98` | Token expired | Refresh access token, retry |
| `Invalid product_code` | Wrong QRIS code | Use `QRIS_DIRECT` or `QRIS` |
| `Missing merchant_id` | Merchant ID not provided | Add `merchant_id` in request |
| `Invalid bank_code` | Bank code not supported | Check bank code list above |
| `Account not found` | Bank account invalid | Verify account number and bank code |
| `Insufficient balance` | Wallet balance too low | Check wallet balance, top-up if needed |
| `Withdrawal exceeded limit` | Amount over max | Check withdrawal limits per bank |

---

## Authentication

### Access Token Flow

```bash
# 1. Login to get access token
curl -X POST 'https://api.ing1.com/v2/user/login' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "your-email@example.com",
    "password": "your-password"
  }'

# Response:
# {
#   "data": {
#     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
#   }
# }

# 2. Use token for subsequent requests
curl -X POST 'https://api.ing1.com/v2/transaction/cashin/create' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
  -H 'Content-Type: application/json' \
  -d '{...}'
```

### Permanent Token

Instead of logging in each time, you can use a permanent token:

```bash
curl -X POST 'https://api.ing1.com/v2/transaction/cashin/create' \
  -H 'Authorization: Bearer YOUR_PERMANENT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{...}'
```

---

## Configuration in Launcx

### Database Setup

```javascript
// MongoDB: Add ING1 sub-merchant
db.sub_merchant.insertOne({
  name: "ING1 Wallet",
  provider: "ing1",
  merchantId: ObjectId("merchant_id_from_db"),
  credentials: {
    baseUrl: "https://api.ing1.com",
    email: "your-email@example.com",
    password: "your-password",
    productCode: "QRIS_DIRECT",
    merchantId: "YOUR_ING1_MERCHANT_ID",
    permanentToken: "your-permanent-token",
    callbackUrl: "https://launcx.com/api/v1/payment/ing1/callback",
    apiVersion: "v2"
  },
  isActive: true,
  schedule: null,
  createdAt: new Date(),
  updatedAt: new Date()
})

// Update partner client to use ING1
db.partnerClient.updateOne(
  { _id: ObjectId("partner_client_id") },
  {
    $set: {
      defaultProvider: "ing1",
      feePercent: 2.0,
      feeFlat: 500,
      withdrawFeePercent: 0.5,
      withdrawFeeFlat: 5000,
      updatedAt: new Date()
    }
  }
)
```

### Environment Variables

```bash
ING1_BASE_URL=https://api.ing1.com
ING1_EMAIL=your-email@example.com
ING1_PASSWORD=your-password
ING1_MERCHANT_ID=YOUR_ING1_MERCHANT_ID
ING1_PRODUCT_CODE=QRIS_DIRECT
ING1_CALLBACK_URL=https://launcx.com/api/v1/payment/ing1/callback
ING1_PERMANENT_TOKEN=your-permanent-token
ING1_API_VERSION=v2
```

---

## Testing Checklist

### Pre-Production (Sandbox/Staging)

- [ ] Create test QRIS payment
  ```bash
  curl -X POST 'https://launcx.com/api/v1/transactions' \
    -H 'Content-Type: application/json' \
    -H 'X-API-Key: TEST_KEY' \
    -d '{"merchantName":"ing1","price":10000,"playerId":"test_player_1"}'
  ```

- [ ] Scan QR code and verify payment
- [ ] Check payment status
  ```bash
  curl -X GET 'https://launcx.com/api/v1/orders/ORDER_ID' \
    -H 'Authorization: Bearer TOKEN'
  ```

- [ ] Test bank transfer (validation)
  ```bash
  curl -X POST 'https://launcx.com/api/v1/client/withdrawals/validate' \
    -H 'Content-Type: application/json' \
    -H 'Authorization: Bearer TOKEN' \
    -d '{"account_number":"1234567890","bank_code":"014","sourceProvider":"ing1","amount":50000}'
  ```

- [ ] Test bank transfer (withdrawal)
  ```bash
  curl -X POST 'https://launcx.com/api/v1/client/withdrawals' \
    -H 'Content-Type: application/json' \
    -H 'Authorization: Bearer TOKEN' \
    -d '{"subMerchantId":"ID","sourceProvider":"ing1","account_number":"1234567890","bank_code":"014","amount":50000,"account_name":"TEST","bank_name":"BCA"}'
  ```

- [ ] Verify callback reception

### Production Deployment

- [ ] Switch to production API URLs
- [ ] Update merchant credentials
- [ ] Update callback URLs to production domain
- [ ] Test with small amounts (Rp 10,000)
- [ ] Monitor first 24 hours
- [ ] Verify all callbacks received
- [ ] Enable transaction logging

---

## Limitations & Notes

### What INA/ING1 Does NOT Support

1. ❌ **Virtual Account (VA)** - Only QRIS and Bank Transfer
2. ❌ **E-Wallets** (GoPay, OVO, DANA, LinkAja) - Use OY Indonesia instead
3. ❌ **Credit/Debit Card** - Use Pivot/Genesis instead
4. ❌ **Installments** - Not supported
5. ❌ **Bill Payment** - Only cash-in and bank transfer

### Best For

- ✅ Simple QRIS payments
- ✅ Quick checkout (any e-wallet via QRIS)
- ✅ Bank transfers and payouts
- ✅ High-volume transactions
- ✅ Merchants with BCA/Mandiri/BNI focus

### Not Best For

- Multi-payment method support (use OY Indonesia)
- Credit card payments (use Pivot/Genesis)
- E-wallet specific optimization (use OY Indonesia)
- Virtual account emphasis (use OY Indonesia/Hilogate)

---

## Support

**Documentation Files:**
- `docs/providers/ing1/README.md` - Full provider documentation
- `docs/providers/ing1/QUICK_START.md` - Quick start guide
- `docs/providers/ing1/SECRETS.md` - Secrets management

**API Client Code:**
- `src/service/ing1Client.ts` - ING1 API client implementation
- `src/service/ing1Status.ts` - Status mapping utilities

**Common Issues:**
- Callback not received → Check return_url is accessible
- Token expired → Add permanent token to credentials
- Bank transfer fails → Verify account number and bank code
- QRIS not showing → Check productCode is QRIS_DIRECT

---

**Last Updated**: 2025-10-22
**API Version**: ING1 Biller Engine v2
**Status**: Production Ready ✅

---

## Quick Links

- [ING1 Provider Documentation](./docs/providers/ing1/README.md)
- [ING1 Quick Start](./docs/providers/ing1/QUICK_START.md)
- [Payment Methods Curl Reference](./PAYMENT_METHODS_CURL.md)
- [Postman Collection](./INA%20Payment%20API%20-%20Complete%20Collection.postman_collection.json)
