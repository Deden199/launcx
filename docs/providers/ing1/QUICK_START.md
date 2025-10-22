# ING1 Quick Start Guide

Get started with ING1 integration in 5 minutes.

---

## Prerequisites Checklist

- [ ] ING1 merchant account
- [ ] ING1 API credentials (email, password, merchant ID)
- [ ] Database access to Launcx
- [ ] API key or client account

---

## Step 1: Configure ING1 Credentials (2 minutes)

### Add to Database

```javascript
// Connect to MongoDB
use laucxdb

// Create merchant (if not exists)
db.merchant.insertOne({
  name: "ing1",
  createdAt: new Date(),
  updatedAt: new Date()
})

// Get merchant ID
const merchantId = db.merchant.findOne({ name: "ing1" })._id

// Create sub-merchant with ING1 credentials
db.sub_merchant.insertOne({
  name: "ING1 Wallet",
  provider: "ing1",
  merchantId: merchantId,
  credentials: {
    baseUrl: "https://api.ing1.com",  // Your ING1 API URL
    email: "your-email@example.com",   // Your ING1 account email
    password: "your-password",          // Your ING1 password
    productCode: "QRIS",                // Product code (QRIS, VA, etc)
    callbackUrl: "https://launcx.com/api/v1/payment/ing1/callback",
    permanentToken: "your-token",       // Optional permanent token
    merchantId: "YOUR_ING1_MERCHANT_ID", // ING1 merchant identifier
    apiVersion: "v2"                    // API version
  },
  schedule: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
})
```

---

## Step 2: Configure Partner Client (1 minute)

```javascript
// Update partner client to use ING1
db.partnerClient.updateOne(
  { _id: ObjectId("YOUR_PARTNER_CLIENT_ID") },
  {
    $set: {
      defaultProvider: "ing1",
      feePercent: 2,           // 2% fee
      feeFlat: 500,            // Rp 500 flat
      withdrawFeePercent: 0.5, // 0.5% withdrawal fee
      withdrawFeeFlat: 5000,   // Rp 5000 flat
      updatedAt: new Date()
    }
  }
)
```

---

## Step 3: Test Payment (1 minute)

### Create a test transaction

```bash
curl --location 'https://launcx.com/api/v1/transactions' \
--header 'Content-Type: application/json' \
--header 'X-API-Key: a240f00aba8cdb2d8622ae778fa36598' \
--data '{
  "price": 10000,
  "playerId": "test_player_001"
}'
```

### Expected Response

```json
{
  "success": true,
  "data": {
    "orderId": "68f47b4a77e208ab5ee8f980",
    "checkoutUrl": "https://...",
    "qrPayload": "00020101...",
    "playerId": "test_player_001",
    "totalAmount": 10000
  }
}
```

---

## Step 4: Test Withdrawal (1 minute)

### Get available wallets

```bash
curl --location 'https://launcx.com/api/v1/client/withdrawals/sub-merchants?clientId=all' \
--header 'Authorization: Bearer YOUR_TOKEN'
```

### Validate bank account

```bash
curl --location 'https://launcx.com/api/v1/client/withdrawals/validate' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer YOUR_TOKEN' \
--data '{
  "account_number": "1234567890",
  "bank_code": "014",
  "sourceProvider": "ing1",
  "amount": 50000
}'
```

### Create withdrawal

```bash
curl --location 'https://launcx.com/api/v1/client/withdrawals' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer YOUR_TOKEN' \
--data '{
  "subMerchantId": "YOUR_SUBMERCHANT_ID",
  "sourceProvider": "ing1",
  "account_number": "1234567890",
  "bank_code": "014",
  "amount": 50000,
  "account_name": "JOHN DOE",
  "bank_name": "Bank Central Asia"
}'
```

---

## Step 5: Verify Integration (30 seconds)

### Check payment status

```bash
curl --location 'https://launcx.com/api/v1/orders/68f47b4a77e208ab5ee8f980' \
--header 'Authorization: Bearer YOUR_TOKEN'
```

### Check withdrawal status

```bash
curl --location 'https://launcx.com/api/v1/client/withdrawals?status=PENDING' \
--header 'Authorization: Bearer YOUR_TOKEN'
```

---

## Troubleshooting

### ❌ "No active provider found"

**Fix:**
```javascript
db.sub_merchant.updateOne(
  { provider: "ing1" },
  { $set: { isActive: true } }
)
```

### ❌ "Invalid credentials"

**Fix:**
```javascript
db.sub_merchant.updateOne(
  { provider: "ing1" },
  {
    $set: {
      "credentials.email": "correct-email@example.com",
      "credentials.password": "correct-password",
      "credentials.permanentToken": "correct-token"
    }
  }
)
```

### ❌ "Callback not received"

**Check:**
1. Callback URL is accessible: `https://launcx.com/api/v1/payment/ing1/callback`
2. Firewall allows ING1 IP addresses
3. Server is running
4. Check logs for incoming requests

**Temporary workaround:**
Run fallback status check manually or wait for automatic fallback.

---

## Next Steps

1. **Read full documentation:**
   - [ING1 Provider Guide](./README.md)
   - [cURL Examples](./CURL_EXAMPLES.md)
   - [Configuration Guide](./CONFIGURATION.md)

2. **Test thoroughly:**
   - Test payment success flow
   - Test payment failure flow
   - Test withdrawal success flow
   - Test withdrawal failure flow
   - Test callbacks

3. **Monitor:**
   - Set up logging
   - Monitor transaction status
   - Set up alerts for failures

4. **Go live:**
   - Switch to production credentials
   - Update callback URLs
   - Test with real money (small amounts)
   - Monitor closely for first week

---

## Quick Reference

### Common Bank Codes

| Code | Bank |
|------|------|
| `014` | BCA |
| `002` | BRI |
| `008` | Mandiri |
| `009` | BNI |

### Status Codes

**Payment:**
- `PENDING` → Payment awaiting
- `PAID` → Payment received
- `SETTLED` → Completed

**Withdrawal:**
- `PENDING` → Processing
- `COMPLETED` → Success
- `FAILED` → Failed (refunded)

### Important Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/transactions` | POST | Create payment |
| `/api/v1/orders/{id}` | GET | Check payment |
| `/api/v1/client/withdrawals/validate` | POST | Validate account |
| `/api/v1/client/withdrawals` | POST | Create withdrawal |
| `/api/v1/client/withdrawals` | GET | List withdrawals |

---

## Support

**Documentation:**
- See `docs/providers/ing1/` folder

**Issues:**
- Check error logs
- Verify configuration
- Test credentials
- Contact support

---

**Last Updated:** October 2025
**Quick Start Version:** 1.0

✅ **You're ready to start using ING1!**
