# INA/INACASH CURL Examples

Complete CURL examples for INA/INACASH provider payment and withdrawal operations.

---

## ⚠️ Important: Authentication Requirements

All API requests to the Launcx platform require:

1. **X-API-Key**: Your partner client API key (from `PartnerClient.apiKey`)
2. **X-Timestamp**: Current Unix timestamp in milliseconds
   - Must be within 5 minutes of server time
   - Generate: `date +%s000` (Linux/Mac) or `[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()` (PowerShell)

**Common Error:**
```json
{
  "error": "Invalid or expired timestamp"
}
```
This means your `X-Timestamp` header is missing, malformed, or more than 5 minutes old/future.

---

## Table of Contents

1. [Payment Operations](#payment-operations)
2. [Withdrawal Operations](#withdrawal-operations)
3. [Callback Testing](#callback-testing)
4. [Status Checking](#status-checking)

---

## Payment Operations

### 1. Create Payment Transaction (QRIS)

**Endpoint:** `POST /api/v1/transactions` or `POST /api/v1/payments`

**Important Headers:**
- `X-API-Key`: Your partner client API key
- `X-Timestamp`: Current Unix timestamp in milliseconds (must be within 5 minutes)
- `Content-Type`: application/json

**Production:**
```bash
curl --location 'https://your-domain.com/api/v1/payments' \
--header 'X-API-Key: YOUR_API_KEY' \
--header "X-Timestamp: $(date +%s)000" \
--header 'Content-Type: application/json' \
--data '{
  "merchantName": "INA",
  "price": 50000,
  "playerId": "player_12345",
  "flow": "embed",
  "paymentChannel": "qris"
}'
```

**Staging:**
```bash
curl --location 'https://your-staging-domain.com/api/v1/payments' \
--header 'X-API-Key: YOUR_STAGING_API_KEY' \
--header "X-Timestamp: $(date +%s)000" \
--header 'Content-Type: application/json' \
--data '{
  "merchantName": "INA",
  "price": 10000,
  "playerId": "test_player_001",
  "flow": "embed",
  "paymentChannel": "qris"
}'
```

**Windows PowerShell:**
```powershell
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
curl --location 'https://your-domain.com/api/v1/payments' `
--header 'X-API-Key: YOUR_API_KEY' `
--header "X-Timestamp: $timestamp" `
--header 'Content-Type: application/json' `
--data '{\"merchantName\":\"INA\",\"price\":50000,\"playerId\":\"player_12345\",\"flow\":\"embed\",\"paymentChannel\":\"qris\"}'
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "orderId": "order_1729335000000",
    "amount": 50000,
    "qrCode": "00020101021226660014ID.CO.INACASH...",
    "qrCodeUrl": "https://api.inacash.co.id/qr/xxx",
    "status": "PENDING",
    "expiredAt": "2025-10-20T10:30:00Z",
    "createdAt": "2025-10-20T10:00:00Z"
  }
}
```

### 2. Create Payment Transaction (Virtual Account)

**Production:**
```bash
curl --location 'https://your-domain.com/api/v1/transactions' \
--header 'X-API-Key: YOUR_API_KEY' \
--header 'X-API-Secret: YOUR_API_SECRET' \
--header 'Content-Type: application/json' \
--data '{
  "merchantName": "INA",
  "price": 100000,
  "playerId": "player_12345",
  "flow": "embed",
  "paymentChannel": "va_bca"
}'
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "orderId": "order_1729335100000",
    "amount": 100000,
    "vaNumber": "8808012345678901",
    "bankCode": "014",
    "bankName": "Bank Central Asia",
    "status": "PENDING",
    "expiredAt": "2025-10-21T10:00:00Z",
    "createdAt": "2025-10-20T10:00:00Z"
  }
}
```

### 3. Check Payment Status

**Production:**
```bash
curl --location 'https://your-domain.com/api/v1/transactions/order_1729335000000' \
--header 'X-API-Key: YOUR_API_KEY' \
--header 'X-API-Secret: YOUR_API_SECRET'
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "orderId": "order_1729335000000",
    "amount": 50000,
    "status": "SUCCESS",
    "paidAt": "2025-10-20T10:15:00Z",
    "settlementAmount": 48500,
    "fee": 1500
  }
}
```

---

## Withdrawal Operations

### 1. Validate Bank Account (Inquiry)

**Endpoint:** `POST /api/v1/client/withdrawals/validate`

**Production:**
```bash
curl --location 'https://your-domain.com/api/v1/client/withdrawals/validate' \
--header 'Authorization: Bearer YOUR_CLIENT_TOKEN' \
--header 'Content-Type: application/json' \
--data '{
  "account_number": "1234567890",
  "bank_code": "014",
  "sourceProvider": "ing1",
  "amount": 50000
}'
```

**Staging:**
```bash
curl --location 'https://your-staging-domain.com/api/v1/client/withdrawals/validate' \
--header 'Authorization: Bearer YOUR_STAGING_TOKEN' \
--header 'Content-Type: application/json' \
--data '{
  "account_number": "1111111111",
  "bank_code": "014",
  "sourceProvider": "ing1",
  "amount": 10000
}'
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "accountName": "JOHN DOE",
    "accountNumber": "1234567890",
    "bankCode": "014",
    "bankName": "Bank Central Asia",
    "fee": 2500,
    "totalAmount": 52500,
    "reference": "ING_INQ_123456789",
    "valid": true
  }
}
```

### 2. Create Withdrawal Request

**Endpoint:** `POST /api/v1/client/withdrawals`

**Production:**
```bash
curl --location 'https://your-domain.com/api/v1/client/withdrawals' \
--header 'Authorization: Bearer YOUR_CLIENT_TOKEN' \
--header 'Content-Type: application/json' \
--data '{
  "subMerchantId": "SUB_MERCHANT_OBJECTID",
  "sourceProvider": "ing1",
  "account_number": "1234567890",
  "bank_code": "014",
  "amount": 100000,
  "account_name": "JOHN DOE",
  "bank_name": "Bank Central Asia",
  "otp": "123456"
}'
```

**Staging:**
```bash
curl --location 'https://your-staging-domain.com/api/v1/client/withdrawals' \
--header 'Authorization: Bearer YOUR_STAGING_TOKEN' \
--header 'Content-Type: application/json' \
--data '{
  "subMerchantId": "SUB_MERCHANT_OBJECTID",
  "sourceProvider": "ing1",
  "account_number": "1111111111",
  "bank_code": "014",
  "amount": 50000,
  "account_name": "TEST USER",
  "bank_name": "Bank Central Asia",
  "otp": "123456"
}'
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "withdrawalId": "wd_1729335200000",
    "refId": "wd-1729335200000",
    "amount": 100000,
    "fee": 2500,
    "totalAmount": 102500,
    "accountNumber": "1234567890",
    "accountName": "JOHN DOE",
    "bankCode": "014",
    "bankName": "Bank Central Asia",
    "status": "PENDING",
    "paymentGatewayId": "ING_WD_789012345",
    "createdAt": "2025-10-20T10:30:00Z"
  }
}
```

### 3. Check Withdrawal Status

**Production:**
```bash
curl --location 'https://your-domain.com/api/v1/client/withdrawals/wd-1729335200000' \
--header 'Authorization: Bearer YOUR_CLIENT_TOKEN'
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "withdrawalId": "wd_1729335200000",
    "refId": "wd-1729335200000",
    "amount": 100000,
    "fee": 2500,
    "status": "COMPLETED",
    "completedAt": "2025-10-20T10:45:00Z",
    "paymentGatewayId": "ING_WD_789012345"
  }
}
```

### 4. List Withdrawals

**Production:**
```bash
curl --location 'https://your-domain.com/api/v1/client/withdrawals?page=1&limit=10' \
--header 'Authorization: Bearer YOUR_CLIENT_TOKEN'
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "withdrawals": [
      {
        "withdrawalId": "wd_1729335200000",
        "refId": "wd-1729335200000",
        "amount": 100000,
        "fee": 2500,
        "status": "COMPLETED",
        "createdAt": "2025-10-20T10:30:00Z",
        "completedAt": "2025-10-20T10:45:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

---

## Callback Testing

### 1. Simulate Payment Callback (Success)

**Local Testing:**
```bash
curl --location 'http://localhost:5000/api/v1/payment/ing1/callback?client_reff=order_1729335000000&reff=ING_REF_123456&rc=0&status=PAID&total=50000&paid_at=2025-10-20%2010:15:00&settlement_time=2025-10-20%2011:00:00'
```

**Production:**
```bash
curl --location 'https://your-domain.com/api/v1/payment/ing1/callback?client_reff=order_1729335000000&reff=ING_REF_123456&rc=0&status=PAID&total=50000&paid_at=2025-10-20%2010:15:00&settlement_time=2025-10-20%2011:00:00'
```

### 2. Simulate Payment Callback (Failed)

```bash
curl --location 'http://localhost:5000/api/v1/payment/ing1/callback?client_reff=order_1729335000000&reff=ING_REF_123456&rc=99&status=FAILED&total=50000&paid_at=2025-10-20%2010:15:00'
```

### 3. Simulate Withdrawal Callback (Success)

**Local Testing:**
```bash
curl --location 'http://localhost:5000/api/v1/withdrawals/ing1/callback?client_reff=wd-1729335200000&reff=ING_WD_789012&rc=0&status=SUCCESS&fee=2500&completed_at=2025-10-20%2010:45:00'
```

**Production:**
```bash
curl --location 'https://your-domain.com/api/v1/withdrawals/ing1/callback?client_reff=wd-1729335200000&reff=ING_WD_789012&rc=0&status=SUCCESS&fee=2500&completed_at=2025-10-20%2010:45:00'
```

### 4. Simulate Withdrawal Callback (Failed)

```bash
curl --location 'http://localhost:5000/api/v1/withdrawals/ing1/callback?client_reff=wd-1729335200000&reff=ING_WD_789012&rc=99&status=FAILED&fee=0&completed_at=2025-10-20%2010:45:00'
```

---

## Status Checking

### 1. Query Pending Withdrawals (Internal/Admin)

**Endpoint:** `POST /api/v1/internal/query-pending-ing1-withdrawals`

```bash
curl --location --request POST 'https://your-domain.com/api/v1/internal/query-pending-ing1-withdrawals' \
--header 'Authorization: Bearer YOUR_ADMIN_TOKEN'
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "processed": 5,
    "updated": 3,
    "failed": 0,
    "details": [
      {
        "refId": "wd-1729335200000",
        "status": "COMPLETED",
        "updated": true
      }
    ]
  }
}
```

### 2. Get Bank List

```bash
curl --location 'https://your-domain.com/api/v1/banks' \
--header 'Authorization: Bearer YOUR_CLIENT_TOKEN'
```

**Response Example:**
```json
{
  "success": true,
  "data": [
    {
      "code": "014",
      "name": "Bank Central Asia"
    },
    {
      "code": "008",
      "name": "Bank Mandiri"
    },
    {
      "code": "009",
      "name": "Bank Negara Indonesia"
    },
    {
      "code": "002",
      "name": "Bank Rakyat Indonesia"
    }
  ]
}
```

---

## Direct INA/INACASH API Examples

### Payment Creation (Direct to INACASH)

**Production:**
```bash
curl --location 'http://core.inacash.co.id/api/v2/payment/create' \
--header 'Content-Type: application/json' \
--data '{
  "merchantId": "INA-00022000137",
  "email": "logigits@gmail.com",
  "password": "50571989",
  "amount": 50000,
  "clientReff": "order_1729335000000",
  "paymentMethod": "QRIS",
  "callbackUrl": "https://your-domain.com/api/v1/payment/ing1/callback"
}'
```

**Staging:**
```bash
curl --location 'https://api-dev.inacash.co.id/api/v2/payment/create' \
--header 'Content-Type: application/json' \
--data '{
  "merchantId": "INAC7417098799",
  "email": "c@launcx.com",
  "password": "44895985",
  "amount": 10000,
  "clientReff": "test_order_001",
  "paymentMethod": "QRIS",
  "callbackUrl": "https://your-staging-domain.com/api/v1/payment/ing1/callback"
}'
```

### Withdrawal Inquiry (Direct to INACASH)

**Production:**
```bash
curl --location 'http://core.inacash.co.id/api/v2/cashout/inquiry' \
--header 'Content-Type: application/json' \
--data '{
  "merchantId": "INA-00022000137",
  "email": "logigits@gmail.com",
  "password": "50571989",
  "bankCode": "014",
  "accountNumber": "1234567890",
  "amount": 50000,
  "clientReff": "inq-1729335300000"
}'
```

**Staging:**
```bash
curl --location 'https://api-dev.inacash.co.id/api/v2/cashout/inquiry' \
--header 'Content-Type: application/json' \
--data '{
  "merchantId": "INAC7417098799",
  "email": "c@launcx.com",
  "password": "44895985",
  "bankCode": "014",
  "accountNumber": "1111111111",
  "amount": 10000,
  "clientReff": "test_inq_001"
}'
```

### Withdrawal Payment (Direct to INACASH)

**Production:**
```bash
curl --location 'http://core.inacash.co.id/api/v2/cashout/payment' \
--header 'Content-Type: application/json' \
--data '{
  "merchantId": "INA-00022000137",
  "email": "logigits@gmail.com",
  "password": "50571989",
  "reff": "ING_INQ_123456789",
  "clientReff": "wd-1729335400000",
  "amount": 50000
}'
```

---

## Common Bank Codes

| Bank Code | Bank Name |
|-----------|-----------|
| `002` | Bank Rakyat Indonesia (BRI) |
| `008` | Bank Mandiri |
| `009` | Bank Negara Indonesia (BNI) |
| `011` | Bank Danamon |
| `013` | Bank Permata |
| `014` | Bank Central Asia (BCA) |
| `016` | Bank Maybank Indonesia |
| `022` | Bank CIMB Niaga |
| `213` | Bank BTPN |
| `451` | Bank Syariah Indonesia (BSI) |

---

## Testing Tips

1. **Use Small Amounts in Staging**
   - Test with amounts like 10,000 - 50,000 IDR
   - Verify all flows before production

2. **Test Account Numbers**
   - Check with INACASH for test account numbers
   - Common test accounts: `1111111111`, `9999999999`

3. **Monitor Callbacks**
   - Use ngrok for local callback testing: `ngrok http 5000`
   - Update callback URL in sub_merchant credentials

4. **Check Response Codes**
   - `rc=0`: Success
   - `rc=68`: Pending
   - `rc=99`: Failed

5. **Fallback Testing**
   - Wait for callback timeout to test fallback mechanism
   - Manually trigger: `POST /api/v1/internal/query-pending-ing1-withdrawals`

---

## Error Handling

### Common Error Responses

**Invalid Credentials:**
```json
{
  "success": false,
  "error": "Invalid API credentials",
  "code": "INVALID_CREDENTIALS"
}
```

**Insufficient Balance:**
```json
{
  "success": false,
  "error": "Saldo tidak mencukupi",
  "code": "INSUFFICIENT_BALANCE"
}
```

**Invalid Bank Account:**
```json
{
  "success": false,
  "error": "Invalid bank account",
  "code": "INVALID_ACCOUNT"
}
```

**Invalid OTP:**
```json
{
  "success": false,
  "error": "OTP tidak valid",
  "code": "INVALID_OTP"
}
```

---

## Related Documentation

- [ING1 Configuration Guide](./CONFIGURATION.md)
- [ING1 Secrets Reference](./SECRETS.md)
- [ING1 README](./README.md)

---

**Last Updated:** October 2025
**Document Version:** 1.0