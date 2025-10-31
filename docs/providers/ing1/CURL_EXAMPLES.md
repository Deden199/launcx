# ING1 Provider - cURL Examples

Complete cURL examples for ING1 payment and withdrawal operations.

---

## Authentication

All requests require authentication:
- **Client Dashboard:** `Authorization: Bearer <token>`
- **Server-to-Server:** `X-API-Key: <api-key>`

---

## Payment Operations

### 1. Create Payment Transaction (ING1)

Creates a new payment transaction using ING1 provider.

**Endpoint:** `POST /api/v1/transactions`

**Prerequisites:**
- Partner client must have `defaultProvider: "ing1"`
- Active ING1 sub-merchant credentials configured
- Valid API key

**Request:**
```bash
curl --location 'https://launcx.com/api/v1/transactions' \
--header 'Content-Type: application/json' \
--header 'X-API-Key: a240f00aba8cdb2d8622ae778fa36598' \
--data '{
  "price": 50000,
  "playerId": "player_12345",
  "flow": "embed",
  "paymentChannel": "qris",
  "customerEmail": "customer@example.com",
  "customerFullName": "John Doe",
  "customerPhone": "081234567890",
  "transactionDescription": "Purchase 100 diamonds",
  "expiredTime": 3600
}'
```

**Success Response (201):**
```json
{
  "success": true,
  "data": {
    "orderId": "68f47b4a77e208ab5ee8f980",
    "checkoutUrl": "https://payment-gateway.com/checkout/abc123",
    "qrPayload": "00020101021226...",
    "playerId": "player_12345",
    "totalAmount": 50000
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "`price` harus > 0"
}
```

---

### 2. Check Payment Status

Query the current status of a payment transaction.

**Endpoint:** `GET /api/v1/orders/{orderId}`

**Request:**
```bash
curl --location 'https://launcx.com/api/v1/orders/68f47b4a77e208ab5ee8f980' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "68f47b4a77e208ab5ee8f980",
    "status": "PAID",
    "settlementStatus": "PENDING",
    "amount": 50000,
    "fee3rdParty": 0,
    "feeLauncx": 525,
    "pendingAmount": 49475,
    "settlementAmount": null,
    "rrn": "000370610834",
    "qrPayload": "00020101021226...",
    "createdAt": "2025-10-19T03:00:00.000Z",
    "paymentReceivedTime": "2025-10-19T03:15:00.000Z",
    "settlementTime": null,
    "trxExpirationTime": "2025-10-19T04:00:00.000Z"
  }
}
```

---

### 3. Simulate Payment Callback (Testing)

For testing purposes, simulate ING1 sending a payment callback.

**Endpoint:** `GET /api/v1/payment/ing1/callback`

**Request:**
```bash
curl --location --request GET 'http://localhost:5000/api/v1/payment/ing1/callback?client_reff=68f47b4a77e208ab5ee8f980&reff=ING1_REF_123456&rc=0&status=PAID&total=50000&paid_at=2025-10-19%2010:30:00&settlement_time=2025-10-19%2011:00:00&expired_at=2025-10-19%2012:00:00'
```

**Query Parameters:**
- `client_reff` - Your order ID
- `reff` - ING1 reference number
- `rc` - Response code (0 = success)
- `status` - Transaction status (PAID, FAILED, PENDING)
- `total` - Transaction amount
- `paid_at` - Payment timestamp
- `settlement_time` - Settlement timestamp (optional)
- `expired_at` - Expiration timestamp (optional)

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "OK"
  }
}
```

---

## Withdrawal Operations

### 1. List Available Wallets (Sub-Merchants)

Get list of available ING1 wallets to withdraw from.

**Endpoint:** `GET /api/v1/client/withdrawals/sub-merchants`

**Request:**
```bash
curl --location 'https://launcx.com/api/v1/client/withdrawals/sub-merchants?clientId=all' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

**Success Response (200):**
```json
[
  {
    "id": "674a1b2c3d4e5f6g7h8i9j0k",
    "name": "ING1 Wallet - Main",
    "provider": "ing1",
    "balance": 1250000
  },
  {
    "id": "674a1b2c3d4e5f6g7h8i9j0l",
    "name": "ING1 Wallet - Secondary",
    "provider": "ing1",
    "balance": 750000
  }
]
```

---

### 2. Validate Bank Account (ING1 Inquiry)

**REQUIRED STEP** before creating withdrawal. Validates bank account and gets ING1 reference.

**Endpoint:** `POST /api/v1/client/withdrawals/validate`

**Request:**
```bash
curl --location 'https://launcx.com/api/v1/client/withdrawals/validate' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
--data '{
  "account_number": "1234567890",
  "bank_code": "014",
  "sourceProvider": "ing1",
  "amount": 50000,
  "bank_name": "Bank Central Asia"
}'
```

**Request Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `account_number` | string | Yes | Bank account number |
| `bank_code` | string | Yes | Bank code (014=BCA, 002=BRI, etc) |
| `sourceProvider` | string | Yes | Must be "ing1" |
| `amount` | number | Yes | Amount for validation |
| `bank_name` | string | No | Bank name |

**Success Response (200):**
```json
{
  "account_number": "1234567890",
  "account_holder": "JOHN DOE",
  "bank_code": "014",
  "bank_name": "Bank Central Asia",
  "status": "valid",
  "rc": 0,
  "reff": "ING1_INQ_789012",
  "client_reff": "inq-1729335600000",
  "message": "Account validation successful"
}
```

**Error Response (400):**
```json
{
  "error": "Account inquiry failed",
  "status": "invalid",
  "rc": 99
}
```

**Important Notes:**
- The `reff` value is used in the next step
- Account validation may incur a small fee (check with ING1)
- Keep the `reff` for creating the actual withdrawal

---

### 3. Create Withdrawal Request

Creates a withdrawal after successful account validation.

**Endpoint:** `POST /api/v1/client/withdrawals`

**Request:**
```bash
curl --location 'https://launcx.com/api/v1/client/withdrawals' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
--data '{
  "subMerchantId": "674a1b2c3d4e5f6g7h8i9j0k",
  "sourceProvider": "ing1",
  "account_number": "1234567890",
  "bank_code": "014",
  "account_name": "JOHN DOE",
  "account_name_alias": "John BCA Account",
  "amount": 100000,
  "bank_name": "Bank Central Asia",
  "otp": "123456"
}'
```

**Request Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `subMerchantId` | string | Yes | Wallet ID from step 1 |
| `sourceProvider` | string | Yes | Must be "ing1" |
| `account_number` | string | Yes | Same as validated |
| `bank_code` | string | Yes | Same as validated |
| `amount` | number | Yes | Withdrawal amount (gross) |
| `account_name` | string | No | Account holder name |
| `account_name_alias` | string | No | Friendly name for account |
| `bank_name` | string | No | Bank name |
| `otp` | string | Conditional | Required if 2FA enabled |

**Success Response (201):**
```json
{
  "id": 123,
  "refId": "wd-1729335700000",
  "status": "PENDING"
}
```

**Error Responses:**

**Insufficient Balance (400):**
```json
{
  "error": "Saldo tidak mencukupi"
}
```

**Invalid OTP (400):**
```json
{
  "error": "OTP tidak valid"
}
```

**Below Minimum (400):**
```json
{
  "error": "Minimum withdraw Rp 50000"
}
```

**Invalid Account (400):**
```json
{
  "error": "Akun bank tidak valid"
}
```

---

### 4. List Withdrawal History

Query withdrawal history with filters.

**Endpoint:** `GET /api/v1/client/withdrawals`

**Request - All Withdrawals:**
```bash
curl --location 'https://launcx.com/api/v1/client/withdrawals?page=1&limit=20' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

**Request - Filter by Status:**
```bash
curl --location 'https://launcx.com/api/v1/client/withdrawals?status=PENDING&page=1&limit=20' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

**Request - Filter by Date Range:**
```bash
curl --location 'https://launcx.com/api/v1/client/withdrawals?date_from=2025-10-01T00:00:00.000Z&date_to=2025-10-31T23:59:59.999Z&page=1&limit=20' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

**Request - Search by Reference:**
```bash
curl --location 'https://launcx.com/api/v1/client/withdrawals?ref=wd-1729&page=1&limit=20' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

**Query Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `clientId` | string | Filter by client ID | `"all"` or specific ID |
| `status` | string | Filter by status | `"PENDING"`, `"COMPLETED"`, `"FAILED"` |
| `date_from` | string | Start date (ISO 8601) | `"2025-10-01T00:00:00.000Z"` |
| `date_to` | string | End date (ISO 8601) | `"2025-10-31T23:59:59.999Z"` |
| `ref` | string | Search by reference | `"wd-"` |
| `page` | number | Page number | `1` |
| `limit` | number | Items per page (max 100) | `20` |

**Success Response (200):**
```json
{
  "data": [
    {
      "refId": "wd-1729335700000",
      "bankName": "Bank Central Asia",
      "accountName": "JOHN DOE",
      "accountNumber": "1234567890",
      "amount": 100000,
      "netAmount": 97000,
      "pgFee": 2500,
      "withdrawFeePercent": 2,
      "withdrawFeeFlat": 500,
      "status": "COMPLETED",
      "createdAt": "2025-10-19T10:30:00.000Z",
      "completedAt": "2025-10-19T10:35:00.000Z",
      "wallet": "ING1 Wallet - Main",
      "sourceProvider": "ing1"
    }
  ],
  "total": 1
}
```

---

### 5. Simulate Withdrawal Callback (Testing)

For testing, simulate ING1 sending a withdrawal callback.

**Endpoint:** `GET /api/v1/withdrawals/ing1/callback`

**Request - Success:**
```bash
curl --location --request GET 'http://localhost:5000/api/v1/withdrawals/ing1/callback?client_reff=wd-1729335700000&reff=ING1_WD_456789&rc=0&status=SUCCESS&fee=2500&completed_at=2025-10-19%2011:00:00'
```

**Request - Failed:**
```bash
curl --location --request GET 'http://localhost:5000/api/v1/withdrawals/ing1/callback?client_reff=wd-1729335700000&reff=ING1_WD_456789&rc=99&status=FAILED&completed_at=2025-10-19%2011:00:00'
```

**Query Parameters:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `client_reff` | Withdrawal reference ID | `"wd-1729335700000"` |
| `reff` | ING1 reference | `"ING1_WD_456789"` |
| `rc` | Response code | `0` (success) or `99` (failed) |
| `status` | Status text | `"SUCCESS"`, `"FAILED"` |
| `fee` | ING1 fee amount | `2500` |
| `completed_at` | Completion timestamp | `"2025-10-19 11:00:00"` |

**Success Response (200):**
```json
{
  "ok": true,
  "updated": true
}
```

---

## Administrative Operations

### 1. Query Pending ING1 Withdrawals

Manually trigger status check for all pending ING1 withdrawals.

**Endpoint:** `POST /api/v1/internal/query-pending-ing1-withdrawals`

**Request:**
```bash
curl --location --request POST 'https://launcx.com/api/v1/internal/query-pending-ing1-withdrawals' \
--header 'Authorization: Bearer <admin-token>'
```

**Success Response (200):**
```json
{
  "processed": 3,
  "results": [
    {
      "refId": "wd-1729335700000",
      "status": "COMPLETED"
    },
    {
      "refId": "wd-1729335800000",
      "status": "FAILED"
    },
    {
      "refId": "wd-1729335900000",
      "status": "PENDING"
    }
  ]
}
```

**Use Cases:**
- Callback was not received
- Network issues during callback
- Manual status refresh needed
- Debugging stuck transactions

---

### 2. Retry Failed Withdrawal

Retry a failed withdrawal (admin only).

**Endpoint:** `POST /api/v1/withdrawals/{id}/retry`

**Request:**
```bash
curl --location --request POST 'https://launcx.com/api/v1/withdrawals/wd-1729335700000/retry' \
--header 'Authorization: Bearer <admin-token>'
```

**Success Response (200):**
```json
{
  "success": true,
  "result": {
    "refId": "wd-1729335700000",
    "status": "PENDING"
  }
}
```

---

## Complete Workflow Examples

### Payment Flow (End-to-End)

```bash
# Step 1: Create transaction
ORDER_ID=$(curl -s --location 'https://launcx.com/api/v1/transactions' \
--header 'Content-Type: application/json' \
--header 'X-API-Key: a240f00aba8cdb2d8622ae778fa36598' \
--data '{
  "price": 50000,
  "playerId": "player_123",
  "flow": "embed"
}' | jq -r '.data.orderId')

echo "Order ID: $ORDER_ID"

# Step 2: Customer scans QR and pays (external)
# ING1 sends callback automatically

# Step 3: Check status
curl --location "https://launcx.com/api/v1/orders/$ORDER_ID" \
--header 'Authorization: Bearer <token>'
```

### Withdrawal Flow (End-to-End)

```bash
# Step 1: List wallets
WALLET_ID=$(curl -s --location 'https://launcx.com/api/v1/client/withdrawals/sub-merchants?clientId=all' \
--header 'Authorization: Bearer <token>' | jq -r '.[0].id')

echo "Wallet ID: $WALLET_ID"

# Step 2: Validate account
curl --location 'https://launcx.com/api/v1/client/withdrawals/validate' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <token>' \
--data '{
  "account_number": "1234567890",
  "bank_code": "014",
  "sourceProvider": "ing1",
  "amount": 100000
}'

# Step 3: Create withdrawal (if validation successful)
WD_REF=$(curl -s --location 'https://launcx.com/api/v1/client/withdrawals' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <token>' \
--data '{
  "subMerchantId": "'"$WALLET_ID"'",
  "sourceProvider": "ing1",
  "account_number": "1234567890",
  "bank_code": "014",
  "amount": 100000,
  "account_name": "JOHN DOE",
  "bank_name": "Bank Central Asia"
}' | jq -r '.refId')

echo "Withdrawal Ref: $WD_REF"

# Step 4: Monitor status
curl --location "https://launcx.com/api/v1/client/withdrawals?ref=$WD_REF" \
--header 'Authorization: Bearer <token>'
```

---

## Environment-Specific URLs

### Production
```
BASE_URL=https://launcx.com
```

### Staging/Development
```
BASE_URL=http://localhost:5000
```

### Testing
Replace `https://launcx.com` with `http://localhost:5000` in all examples.

---

## Common Bank Codes

| Code | Bank Name | Abbreviation |
|------|-----------|--------------|
| `002` | Bank Rakyat Indonesia | BRI |
| `008` | Bank Mandiri | Mandiri |
| `009` | Bank Negara Indonesia | BNI |
| `013` | Bank Permata | Permata |
| `014` | Bank Central Asia | BCA |
| `022` | CIMB Niaga | CIMB |
| `213` | Bank BTPN | BTPN |
| `426` | Bank Mega | Mega |
| `451` | Bank Syariah Indonesia | BSI |

---

## Troubleshooting

### Payment not updating?
```bash
# Check order status
curl --location 'https://launcx.com/api/v1/orders/{orderId}' \
--header 'Authorization: Bearer <token>'

# Verify callback was received (check database)
# Run fallback manually if needed
```

### Withdrawal stuck in PENDING?
```bash
# Query all pending withdrawals
curl -X POST 'https://launcx.com/api/v1/internal/query-pending-ing1-withdrawals' \
--header 'Authorization: Bearer <admin-token>'
```

### Want to test callbacks locally?
```bash
# Use ngrok to expose local server
ngrok http 5000

# Update ING1 callback URL in sub_merchant credentials to ngrok URL
```

---

**Last Updated:** October 2025
**API Version:** v1
**ING1 Provider Version:** v2
