# Launcx API Integration Guide

## Overview

Launcx provides a unified payment gateway API supporting multiple payment methods:
- **QRIS** - Quick Response Code Indonesia Standard
- **Virtual Account (VA)** - Bank transfer via VA number

Payment providers are selected automatically by Launcx based on your tenant configuration.

## Base URLs

| Environment | URL |
|-------------|-----|
| Production | `https://{LAUNCX_DOMAIN}/api/v1` |
| Staging | `https://{LAUNCX_STAGING_DOMAIN}/api/v1` |

> Contact Launcx team to get your domain URLs.

## Authentication

All API requests require the following headers:

```
Content-Type: application/json
X-API-Key: <YOUR_API_KEY>
X-Timestamp: <Unix timestamp in milliseconds>
```

**Note:** Requests with timestamp difference > 5 minutes will be rejected.

---

## Endpoints

### QRIS Payment

#### Create QRIS Order
```
POST /api/v1/payments
```

**Request:**
```json
{
  "price": 50000,
  "playerId": "user_123",
  "flow": "embed"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "685s6eb9263c75af53ba84b1",
    "checkoutUrl": "https://{DOMAIN}/checkout/{orderId}",
    "qrPayload": "0002010102122667...",
    "totalAmount": 50000,
    "expiredTs": "2025-01-30T15:30:00Z"
  }
}
```

---

### Virtual Account (VA)

#### Create VA
```
POST /api/v1/payments/va
```

**Request:**
```json
{
  "customerId": "user_123",
  "bankCode": "008",
  "amount": 50000,
  "isOpen": false,
  "isSingleUse": true,
  "expirationMinutes": 1440,
  "displayName": "John Doe",
  "referenceId": "TRX-001"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "19cc351e-cd81-4300-af19-ecac8e3a3144",
    "vaNumber": "8618830003000000039",
    "bankCode": "008",
    "bankName": "Mandiri",
    "amount": 50000,
    "status": "PENDING",
    "expiresAt": "2025-01-31T10:00:00Z"
  }
}
```

#### Get VA Info
```
GET /api/v1/payments/va/{vaId}
```

#### Update VA
```
PUT /api/v1/payments/va/{vaId}
```

**Request:**
```json
{
  "amount": 75000,
  "displayName": "Jane Doe"
}
```

---

### Supported Banks

| Code | Bank Name |
|------|-----------|
| 002 | BRI |
| 008 | Mandiri |
| 009 | BNI |
| 013 | Permata |
| 022 | CIMB Niaga |

---

## Transaction Status

### Payment Status

| Status | Description |
|--------|-------------|
| `PENDING` | Waiting for payment |
| `PAID` | Payment received, waiting for settlement |
| `SETTLED` | Settlement completed, balance credited |
| `EXPIRED` | Transaction expired |
| `FAILED` | Transaction failed |

### Settlement Status

| Status | Description |
|--------|-------------|
| `WAITING` | Waiting for settlement process |
| `SUCCESS` | Settlement successful |
| `FAILED` | Settlement failed |

---

## Callbacks

Launcx sends HTTP POST to your callback URL when transaction status changes.

### Callback Payload (Unified Format)

```json
{
  "event": "payment.updated",
  "data": {
    "orderId": "685d4578f2745f068c635f17",
    "channel": "QRIS",
    "status": "SETTLED",
    "settlementStatus": "SUCCESS",
    "grossAmount": 50000,
    "fee": 500,
    "netAmount": 49500,
    "customerId": "user_123",
    "occurredAt": "2025-01-30T14:30:00Z",
    "nonce": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

For VA transactions, additional fields are included:
- `vaNumber` - VA number
- `bankCode` - Bank code
- `bankName` - Bank name (optional)

### Signature Verification

Every callback includes `X-Callback-Signature` header. **Always verify** before processing:

```javascript
import crypto from 'crypto'

function verifyCallbackSignature(body, signature, secret) {
  const payload = JSON.stringify(body)
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}
```

### Best Practices

1. **Always verify signature** - Never process unverified callbacks
2. **Use HTTPS** - Callback URL must use HTTPS
3. **Handle duplicates** - Check `nonce` for idempotency
4. **Respond quickly** - Return 200 OK within 5 seconds

---

## Withdrawal

### Create Withdrawal
```
POST /api/v1/client/withdrawals
Authorization: Bearer <JWT_TOKEN>
```

**Request:**
```json
{
  "amount": 1000000,
  "bankCode": "014",
  "accountNumber": "1234567890",
  "accountName": "John Doe"
}
```

### Withdrawal Status

| Status | Description |
|--------|-------------|
| `PENDING` | Being processed |
| `COMPLETED` | Funds transferred |
| `FAILED` | Failed (balance refunded) |

---

## Error Responses

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

| HTTP Code | Description |
|-----------|-------------|
| 400 | Bad Request |
| 401 | Unauthorized |
| 404 | Not Found |
| 429 | Rate Limited |
| 500 | Internal Error |

---

## SDK Example

```typescript
import axios from 'axios'

class LauncxClient {
  private client

  constructor(config: { apiKey: string; baseURL: string }) {
    this.client = axios.create({
      baseURL: config.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey,
      },
    })

    this.client.interceptors.request.use(cfg => {
      cfg.headers['X-Timestamp'] = Date.now().toString()
      return cfg
    })
  }

  async createQRIS(params) {
    return this.client.post('/payments', params)
  }

  async createVA(params) {
    return this.client.post('/payments/va', params)
  }

  async getVA(vaId) {
    return this.client.get(`/payments/va/${vaId}`)
  }

  async updateVA(vaId, params) {
    return this.client.put(`/payments/va/${vaId}`, params)
  }
}
```

---

## Support

For technical assistance, contact Launcx support team via Dashboard or email.
