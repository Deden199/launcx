# INA/INACASH Complete API Guide

Complete documentation for INA (INACASH) / Billers Engine API integration including payments (Cash-in) and withdrawals (Cash-out/Disbursement).

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Payment Operations (Cash-in)](#payment-operations-cash-in)
4. [Withdrawal Operations (Cash-out)](#withdrawal-operations-cash-out)
5. [Database Collections](#database-collections)
6. [Response Codes](#response-codes)
7. [Callbacks & Webhooks](#callbacks--webhooks)
8. [Complete Examples](#complete-examples)

---

## Overview

### API Information

**Base URLs:**
- **Production:** `http://core.inacash.co.id/api`
- **Staging:** `https://api-dev.inacash.co.id/api`
- **API Version:** `v2`

### Credentials

#### Production
```json
{
  "url": "http://core.inacash.co.id/api",
  "email": "logigits@gmail.com",
  "password": "50571989",
  "merchant_id": "INA-00022000137"
}
```

#### Staging
```json
{
  "url": "https://api-dev.inacash.co.id/api",
  "email": "c@launcx.com",
  "password": "44895985",
  "merchant_id": "INAC7417098799",
  "version": "v2"
}
```

### Key Features

- **Token-Based Authentication** (permanent until password reset)
- **POST-only API** (except callback/history endpoints)
- **JSON Request/Response** format
- **Real-time Callbacks** for transaction status updates

---

## Authentication

### 1. Login

**Endpoint:** `POST {{BASE_URL}}/v2/auth/login`

**Headers:**
```
Content-Type: application/json
Accept: application/json
```

**Request Body:**
```json
{
  "email": "logigits@gmail.com",
  "password": "50571989"
}
```

**Success Response:**
```json
{
  "rc": 0,
  "message": "successfully login",
  "data": {
    "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
    "user": {
      "id": 1,
      "name": "LOGIGITS DIGITAL",
      "email": "logigits@gmail.com",
      "merchant_id": "INA-00022000137"
    }
  }
}
```

**Token Usage:**
```
Authorization: Bearer <token>
```

**Note:** Token lives permanently unless credential is changed/reset.

---

## Payment Operations (Cash-in)

Payment operations allow customers to pay you via QRIS, Virtual Account, or other payment methods.

### 1. Create Payment (QRIS)

**Endpoint:** `POST {{BASE_URL}}/v2/transaction/cashin/create`

**Headers:**
```
Content-Type: application/json
Accept: application/json
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "product_code": "QRIS_DIRECT",
  "amount": 10000,
  "remark": "Payment for Order #123",
  "client_reff": "order_123456",
  "expiry_time": "60",
  "return_url": "https://your-domain.com/api/v1/payment/ing1/callback",
  "merchant_id": "INA-00022000137"
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `product_code` | string | Yes | Payment method code (e.g., "QRIS_DIRECT", "QRIS") |
| `amount` | integer | Yes | Payment amount in IDR |
| `remark` | string | No | Note/description for payment |
| `client_reff` | string | Yes | Your unique order/transaction ID |
| `expiry_time` | string | No | Expiry in minutes (default: 60) |
| `return_url` | string | No | Callback URL for payment status |
| `merchant_id` | string | Yes | Your INA merchant ID |

**Success Response:**
```json
{
  "rc": 0,
  "message": "successfuly create cash-in transaction",
  "data": {
    "amount": 10000,
    "payment_url": null,
    "content": "00020101021226660015COM.INACASH.WWW...",
    "return_url": "https://your-domain.com/callback",
    "status": "pending",
    "remark": "Payment for Order #123",
    "expired_at": "2025-10-20 11:00:00",
    "created_at": "2025-10-20 10:00:00"
  },
  "reff": "1729335000ABC123",
  "client_reff": "order_123456",
  "product_code": "QRIS_DIRECT"
}
```

**Response Fields:**

| Field | Description |
|-------|-------------|
| `rc` | Response code (0=success, 99=failed) |
| `data.content` | QRIS string for QR code generation |
| `data.payment_url` | Payment URL (for VA/other methods) |
| `data.status` | Transaction status (pending, paid, failed) |
| `reff` | INA reference ID (save this!) |
| `client_reff` | Your order ID |

### 2. Check Payment Status

**Endpoint:** `POST {{BASE_URL}}/v2/transaction/cashin/check`

**Request Body:**
```json
{
  "reff": "1729335000ABC123",
  "client_reff": "order_123456"
}
```

**Success Response:**
```json
{
  "rc": 0,
  "message": "check status cash-in transaction",
  "data": {
    "amount": 10000,
    "status": "paid",
    "rrn": "quscfMfTW607",
    "paid_at": "2025-10-20 10:15:00",
    "expired_at": "2025-10-20 11:00:00",
    "created_at": "2025-10-20 10:00:00"
  },
  "reff": "1729335000ABC123",
  "client_reff": "order_123456"
}
```

### 3. Payment History

**Endpoint:** `GET {{BASE_URL}}/v2/transaction/cashin/history`

**Query Parameters:**
```
?page=1&per_page=15&start_date=2025-10-01&end_date=2025-10-31&client_reff=order_123&reff=1729335000ABC123
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | integer | No | Page number (default: 1) |
| `per_page` | integer | No | Items per page (default: 15) |
| `start_date` | string | No | Filter start date (YYYY-MM-DD) |
| `end_date` | string | No | Filter end date (YYYY-MM-DD) |
| `client_reff` | string | No | Filter by your order ID |
| `reff` | string | No | Filter by INA reference ID |

**Success Response:**
```json
{
  "rc": 0,
  "message": "successfully get history transaction cashin",
  "histories": [
    {
      "amount": 10000,
      "payment_url": null,
      "content": "",
      "return_url": "https://your-domain.com/callback",
      "status": "success",
      "rrn": "quscfMfTW607",
      "reff": "1729335000ABC123",
      "client_reff": "order_123456",
      "name": "QR Payment",
      "remark": "Payment for Order #123",
      "paid_at": "2025-10-20T10:15:00.000000Z",
      "expired_at": "2025-10-20T11:00:00.000000Z",
      "created_at": "2025-10-20T10:00:00.000000Z"
    }
  ],
  "current_page": 1,
  "per_page": 15,
  "total": 1,
  "last_page": 1,
  "from": 1,
  "to": 15,
  "has_next_page": false,
  "next_page_url": null,
  "prev_page_url": null
}
```

### 4. Payment Callback/Webhook

When payment status changes, INA sends a callback to your `return_url`.

**Method:** `GET`

**URL:** `{{CLIENT_CALLBACK_URL}}?reff={reff}&client_reff={client_reff}&rrn={rrn}&status={status}&amount={amount}&paid_at={paid_at}&expired_at={expired_at}&created_at={created_at}`

**Example Callback:**
```
GET https://your-domain.com/api/v1/payment/ing1/callback?reff=1729335000ABC123&client_reff=order_123456&rrn=quscfMfTW607&status=success&amount=10000&total=10000&remark=Payment&expired_at=2025-10-20+11:00:00&paid_at=2025-10-20+10:15:00&created_at=2025-10-20+10:00:00
```

**Callback Parameters:**

| Parameter | Description |
|-----------|-------------|
| `reff` | INA reference ID |
| `client_reff` | Your order ID |
| `rrn` | Retrieval Reference Number |
| `status` | Payment status (success, failed, pending) |
| `amount` | Payment amount |
| `paid_at` | Payment completion time |

**Response to INA:**
```
HTTP 200 OK
```

---

## Withdrawal Operations (Cash-out)

Withdrawal operations allow you to send money to bank accounts (disbursement).

### 1. Account Inquiry (Validation)

**Endpoint:** `POST {{BASE_URL}}/v2/transaction/inquiry`

**Request Body:**
```json
{
  "product_code": "TRF_BCA",
  "custno": "1234567890",
  "amount": 50000,
  "remark": "Withdrawal to BCA",
  "client_reff": "wd-123456"
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `product_code` | string | Yes | Bank transfer code (TRF_BCA, TRF_BNI, TRF_MANDIRI, TRF_BRI) |
| `custno` | string | Yes | Bank account number |
| `amount` | integer | Yes | Transfer amount in IDR |
| `remark` | string | No | Transfer note |
| `client_reff` | string | Yes | Your unique withdrawal ID |

**Success Response:**
```json
{
  "rc": 0,
  "message": "successfuly",
  "data": {
    "item": {
      "custno": "1234567890",
      "custname": "JOHN DOE",
      "code": "TRF_BCA",
      "name": "Transfer Ke BCA",
      "info": "Transfer ke rekening BCA (Bank Central Asia)",
      "price": 50000,
      "admin": 2500,
      "markup": 1500,
      "merchant_admin": 0,
      "total": 54000,
      "total_price": 52500
    },
    "raw": "Konfirmasi Transaksi||Produk  : Transfer Ke BCA||ID Pel  : 1234567890||Nama    : JOHN DOE||Harga   : Rp 50.000||Admin   : Rp 2.500||Total   : Rp 52.500||",
    "reff": "1729335300XYZ789",
    "client_reff": "wd-123456"
  }
}
```

**Response Fields:**

| Field | Description |
|-------|-------------|
| `custname` | Account holder name from bank |
| `price` | Transfer amount |
| `admin` | Transfer fee |
| `total` | Total amount to be deducted from your balance |
| `reff` | INA reference (use this for payment step) |

### 2. Execute Withdrawal (Payment)

**Endpoint:** `POST {{BASE_URL}}/v2/transaction/payment`

**Request Body:**
```json
{
  "reff": "1729335300XYZ789",
  "pin": null
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reff` | string | Yes | Reference from inquiry step |
| `pin` | string | No | Transaction PIN (if enabled) |

**Success Response (Immediate Success):**
```json
{
  "rc": 0,
  "message": "payment success",
  "data": {
    "item": {
      "custno": "1234567890",
      "custname": "JOHN DOE",
      "name": "Transfer Ke BCA",
      "code": "TRF_BCA",
      "reff": "1729335300XYZ789",
      "price": 50000,
      "admin": 2500,
      "total": 52500,
      "sn": "TRX123456789",
      "status": "SUCCESS"
    },
    "raw": "Transaksi Berhasil||Produk   : Transfer Ke BCA||ID Pel   : 1234567890||Nama     : JOHN DOE||Tgl Bayar: 2025-10-20 10:30:00||Reff     : 1729335300XYZ789||SN       : TRX123456789||Total    : Rp 52.500||",
    "reff": "1729335300XYZ789",
    "code": "TRF_BCA"
  },
  "last_balance": 1000000
}
```

**Pending Response (Need to wait for callback):**
```json
{
  "rc": 91,
  "message": "payment pending",
  "data": {
    "item": {
      "custno": "1234567890",
      "custname": "JOHN DOE",
      "name": "Transfer Ke BCA",
      "reff": "1729335300XYZ789",
      "status": "PENDING"
    }
  }
}
```

**Failed Response:**
```json
{
  "rc": 99,
  "message": "payment failed",
  "data": {
    "item": {
      "reff": "1729335300XYZ789",
      "status": "FAILED",
      "message": "Insufficient balance or invalid account"
    }
  }
}
```

### 3. Withdrawal History

**Endpoint:** `GET {{BASE_URL}}/v2/transaction/cashout/history`

**Query Parameters:**
```
?page=1&per_page=15&start_date=2025-10-01&end_date=2025-10-31&client_reff=wd-123&reff=1729335300XYZ789&status=SUCCESS
```

**Success Response:**
```json
{
  "rc": 0,
  "message": "successfully get history transaction cashout",
  "histories": [
    {
      "custno": "1234567890",
      "price": 50000,
      "admin": 2500,
      "total": 52500,
      "custname": "JOHN DOE",
      "sn": "TRX123456789",
      "reff": "1729335300XYZ789",
      "client_reff": "wd-123456",
      "status": "SUCCESS",
      "created_at": "2025-10-20T10:30:00.000000Z",
      "product_code": "TRF_BCA",
      "product_name": "Transfer Ke BCA"
    }
  ],
  "current_page": 1,
  "per_page": 15,
  "total": 1,
  "last_page": 1
}
```

### 4. Withdrawal Callback/Webhook

When withdrawal completes, INA sends a callback.

**Method:** `GET`

**Example Callback:**
```
GET https://your-domain.com/api/v1/withdrawals/ing1/callback?reff=1729335300XYZ789&client_reff=wd-123456&rc=0&status=SUCCESS&custno=1234567890&custname=JOHN%20DOE&price=50000&admin=2500&total=52500&sn=TRX123456789&completed_at=2025-10-20+10:35:00
```

**Callback Parameters:**

| Parameter | Description |
|-----------|-------------|
| `reff` | INA reference ID |
| `client_reff` | Your withdrawal ID |
| `rc` | Response code (0=success, 99=failed) |
| `status` | Status (SUCCESS, FAILED) |
| `custno` | Bank account number |
| `custname` | Account holder name |
| `price` | Transfer amount |
| `admin` | Transfer fee |
| `total` | Total deducted |
| `sn` | Serial number/transaction ID |
| `completed_at` | Completion timestamp |

---

## Database Collections

### 1. transaction_request

**Purpose:** Main transaction record

```javascript
db.transaction_request.findOne({ playerId: "order_123456" })
```

**Fields:**
- `_id` - Transaction ID
- `merchantId` - Merchant reference
- `subMerchantId` - Sub-merchant (INA provider)
- `buyerId` - Customer ID
- `playerId` - Your order/player ID
- `amount` - Transaction amount
- `status` - PENDING, SUCCESS, FAILED
- `paymentProvider` - "ing1"
- `trxId` - INA reference ID
- `ewalletUrl` - QR code URL
- `createdAt` - Creation timestamp

### 2. transaction_response

**Purpose:** Raw INA API response

```javascript
db.transaction_response.findOne({ referenceId: ObjectId("...") })
```

**Fields:**
- `referenceId` - Links to transaction_request._id
- `responseBody` - Full JSON response from INA API
- `playerId` - Your order ID
- `createdAt` - Timestamp

### 3. transaction_callback

**Purpose:** Callback data from INA

```javascript
db.transaction_callback.find({ referenceId: ObjectId("...") })
```

**Fields:**
- `referenceId` - Links to transaction_request._id
- `requestBody` - Full callback data from INA
- `paymentReceivedTime` - When customer paid
- `settlementTime` - When settled
- `createdAt` - Callback received time

### 4. WithdrawRequest

**Purpose:** Withdrawal/disbursement records

```javascript
db.WithdrawRequest.find({ refId: "wd-123456" })
```

**Fields:**
- `_id` - Withdrawal ID
- `refId` - Your withdrawal reference
- `clientId` - Partner client ID
- `subMerchantId` - Sub-merchant ID
- `accountNumber` - Bank account number
- `accountName` - Account holder name
- `bankCode` - Bank code (014, 008, 009, 002)
- `bankName` - Bank name
- `amount` - Withdrawal amount
- `fee` - Transfer fee
- `status` - PENDING, COMPLETED, FAILED
- `paymentGatewayId` - INA reference (reff)
- `createdAt` - Creation time
- `completedAt` - Completion time

---

## Response Codes

| Code | Status | Description |
|------|--------|-------------|
| `0` | SUCCESS | Transaction successful |
| `91` | PENDING | Transaction pending (wait for callback) |
| `99` | FAILED | Transaction failed |
| `98` | INVALID_TOKEN | Invalid/expired authentication token |

---

## Callbacks & Webhooks

### Security

INA callbacks use **query parameters** without signature verification in the current implementation.

### Idempotency

- Always check if callback was already processed
- Use `client_reff` or `reff` to identify transactions
- Store callbacks in `transaction_callback` collection

### Callback Response

Always respond with HTTP 200 to acknowledge receipt:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"status": "ok"}
```

### Callback Retry

If INA doesn't receive HTTP 200, it may retry the callback.

---

## Complete Examples

### Complete Payment Flow

```bash
# 1. Login
curl -X POST 'http://core.inacash.co.id/api/v2/auth/login' \
-H 'Content-Type: application/json' \
-d '{
  "email": "logigits@gmail.com",
  "password": "50571989"
}'

# Save token from response

# 2. Create Payment
curl -X POST 'http://core.inacash.co.id/api/v2/transaction/cashin/create' \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer YOUR_TOKEN' \
-d '{
  "product_code": "QRIS_DIRECT",
  "amount": 10000,
  "client_reff": "order_123456",
  "expiry_time": "60",
  "return_url": "https://your-domain.com/callback",
  "merchant_id": "INA-00022000137"
}'

# Save reff from response

# 3. Check Status
curl -X POST 'http://core.inacash.co.id/api/v2/transaction/cashin/check' \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer YOUR_TOKEN' \
-d '{
  "reff": "1729335000ABC123",
  "client_reff": "order_123456"
}'

# 4. Wait for callback or poll status
```

### Complete Withdrawal Flow

```bash
# 1. Login (same as above)

# 2. Account Inquiry
curl -X POST 'http://core.inacash.co.id/api/v2/transaction/inquiry' \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer YOUR_TOKEN' \
-d '{
  "product_code": "TRF_BCA",
  "custno": "1234567890",
  "amount": 50000,
  "client_reff": "wd-123456"
}'

# Save reff from response

# 3. Execute Payment
curl -X POST 'http://core.inacash.co.id/api/v2/transaction/payment' \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer YOUR_TOKEN' \
-d '{
  "reff": "1729335300XYZ789",
  "pin": null
}'

# 4. Wait for callback (if rc=91) or immediate success (if rc=0)
```

---

## Bank Transfer Product Codes

| Product Code | Bank Name | Admin Fee |
|--------------|-----------|-----------|
| `TRF_BCA` | Bank Central Asia | 2,500 |
| `TRF_BNI` | Bank Negara Indonesia | 2,500 |
| `TRF_MANDIRI` | Bank Mandiri | 2,500 |
| `TRF_BRI` | Bank Rakyat Indonesia | 2,500 |
| `TRF_PERMATA` | Bank Permata | 2,500 |
| `TRF_CIMB` | Bank CIMB Niaga | 2,500 |

---

## Best Practices

1. **Always validate account** before creating withdrawal
2. **Store INA `reff`** for tracking and reconciliation
3. **Handle callbacks idempotently** - check if already processed
4. **Monitor fallback jobs** for missed callbacks
5. **Log all API responses** for debugging
6. **Implement retry logic** for network failures
7. **Test with small amounts** before production
8. **Set up monitoring** for failed transactions

---

## Troubleshooting

### Payment Issues

**Issue:** Payment not updating after customer pays
- Check callback URL is reachable from INA servers
- Verify `return_url` in create payment request
- Manually check status using check endpoint

**Issue:** QRIS code not generating
- Verify `product_code` is "QRIS_DIRECT" or "QRIS"
- Check `merchant_id` is correct
- Ensure amount is > 0

### Withdrawal Issues

**Issue:** Account inquiry fails
- Verify bank account number format
- Check `product_code` matches bank
- Ensure sufficient balance

**Issue:** Withdrawal stuck in PENDING
- Wait for callback (usually 1-2 minutes)
- Check callback URL is accessible
- Manually check status in history endpoint

---

## Support

For technical issues or questions:
- **Email:** support@inacash.co.id
- **Documentation:** Contact INA team for latest API docs

---

**Last Updated:** October 2025
**API Version:** v2
**Document Version:** 1.0