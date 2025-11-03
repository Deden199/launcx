# ING1 Provider Configuration Guide

This guide explains how to configure ING1 provider in the Launcx platform.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Database Configuration](#database-configuration)
3. [Environment Variables](#environment-variables)
4. [Partner Client Setup](#partner-client-setup)
5. [Testing Configuration](#testing-configuration)
6. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before configuring ING1, ensure you have:

- ✅ ING1 merchant account credentials
- ✅ ING1 API access (base URL, email, password)
- ✅ ING1 merchant ID
- ✅ ING1 permanent token (if required)
- ✅ Callback URL configured in ING1 dashboard
- ✅ Database access to Launcx platform
- ✅ Admin access to partner client configuration

---

## Database Configuration

### 1. Create Sub-Merchant Entry

ING1 credentials are stored in the `sub_merchant` collection. Create a new entry:

```javascript
// MongoDB document structure
{
  _id: ObjectId("..."),
  name: "ING1 Wallet - Production",
  provider: "ing1",
  merchantId: "merchant_001",  // Reference to parent merchant
  credentials: {
    baseUrl: "https://api.ing1.com",
    email: "your-merchant@example.com",
    password: "your-secure-password",
    productCode: "QRIS",
    callbackUrl: "https://launcx.com/api/v1/payment/ing1/callback",
    permanentToken: "your-permanent-token-here",
    merchantId: "ING1_MERCHANT_ID",
    apiVersion: "v2"
  },
  schedule: "weekday",  // or "weekend" or null
  isActive: true,
  createdAt: ISODate("2025-10-19T00:00:00.000Z"),
  updatedAt: ISODate("2025-10-19T00:00:00.000Z")
}
```

### 2. Create Parent Merchant (if not exists)

```javascript
{
  _id: ObjectId("merchant_001"),
  name: "ing1",
  createdAt: ISODate("2025-10-19T00:00:00.000Z"),
  updatedAt: ISODate("2025-10-19T00:00:00.000Z")
}
```

### 3. Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name for the wallet |
| `provider` | string | Yes | Must be "ing1" |
| `merchantId` | ObjectId | Yes | Reference to parent merchant |
| `credentials.baseUrl` | string | Yes | ING1 API base URL |
| `credentials.email` | string | Yes | ING1 account email |
| `credentials.password` | string | Yes | ING1 account password |
| `credentials.productCode` | string | Yes | Product code (e.g., "QRIS") |
| `credentials.callbackUrl` | string | Yes | Callback URL for this wallet |
| `credentials.permanentToken` | string | No | Permanent auth token (if used) |
| `credentials.merchantId` | string | Yes | ING1 merchant identifier |
| `credentials.apiVersion` | string | Yes | API version (e.g., "v2") |
| `schedule` | string | No | "weekday", "weekend", or null |
| `isActive` | boolean | Yes | true to enable, false to disable |

### 4. Example MongoDB Commands

**Insert new sub-merchant:**
```javascript
db.sub_merchant.insertOne({
  name: "ING1 Wallet - Main",
  provider: "ing1",
  merchantId: ObjectId("merchant_id_here"),
  credentials: {
    baseUrl: "https://api.ing1.com",
    email: "merchant@example.com",
    password: "secure_password",
    productCode: "QRIS",
    callbackUrl: "https://launcx.com/api/v1/payment/ing1/callback",
    permanentToken: "token_here",
    merchantId: "ING1_MERCHANT_123",
    apiVersion: "v2"
  },
  schedule: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
})
```

**Update existing sub-merchant:**
```javascript
db.sub_merchant.updateOne(
  { _id: ObjectId("sub_merchant_id") },
  {
    $set: {
      "credentials.baseUrl": "https://new-api.ing1.com",
      "credentials.permanentToken": "new_token",
      updatedAt: new Date()
    }
  }
)
```

**Disable sub-merchant:**
```javascript
db.sub_merchant.updateOne(
  { _id: ObjectId("sub_merchant_id") },
  { $set: { isActive: false, updatedAt: new Date() } }
)
```

---

## Environment Variables

While ING1 credentials are primarily stored in the database, you may need these global settings:

```bash
# In .env or env.txt file

# Application
NODE_ENV=production
BASE_URL=https://launcx.com

# Database
DATABASE_URL="mongodb+srv://user:pass@cluster.mongodb.net/laucxdb"

# Optional: Global ING1 settings (usually not needed)
# ING1_DEFAULT_TIMEOUT=30000
# ING1_MAX_RETRIES=3
```

---

## Partner Client Setup

### 1. Configure Partner Client

Set ING1 as the default provider for a partner client:

```javascript
db.partnerClient.updateOne(
  { _id: ObjectId("partner_client_id") },
  {
    $set: {
      defaultProvider: "ing1",
      forceSchedule: null,  // or "weekday" / "weekend"
      feePercent: 2,        // 2% fee
      feeFlat: 500,         // Rp 500 flat fee
      weekendFeePercent: 3, // Weekend fee
      weekendFeeFlat: 750,
      withdrawFeePercent: 0.5,
      withdrawFeeFlat: 5000,
      callbackUrl: "https://partner.com/callback",
      callbackSecret: "partner_secret_key",
      updatedAt: new Date()
    }
  }
)
```

### 2. Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `defaultProvider` | string | Set to "ing1" to use ING1 |
| `forceSchedule` | string | Force "weekday" or "weekend" sub-merchant |
| `feePercent` | number | Launcx fee percentage (weekday) |
| `feeFlat` | number | Launcx flat fee (weekday) |
| `weekendFeePercent` | number | Launcx fee percentage (weekend) |
| `weekendFeeFlat` | number | Launcx flat fee (weekend) |
| `withdrawFeePercent` | number | Withdrawal fee percentage |
| `withdrawFeeFlat` | number | Withdrawal flat fee |
| `callbackUrl` | string | Partner's callback URL |
| `callbackSecret` | string | HMAC secret for callbacks |

### 3. Create Client User

Create a user account for the partner client:

```javascript
db.clientUser.insertOne({
  email: "client@example.com",
  passwordHash: "bcrypt_hash_here",
  partnerClientId: ObjectId("partner_client_id"),
  totpEnabled: false,
  totpSecret: null,
  createdAt: new Date(),
  updatedAt: new Date()
})
```

---

## Schedule Configuration

The `schedule` field allows you to have different credentials for weekdays and weekends:

### Example: Two Wallets (Weekday + Weekend)

**Weekday Wallet:**
```javascript
{
  name: "ING1 Wallet - Weekday",
  provider: "ing1",
  schedule: "weekday",
  isActive: true,
  credentials: { /* ... */ }
}
```

**Weekend Wallet:**
```javascript
{
  name: "ING1 Wallet - Weekend",
  provider: "ing1",
  schedule: "weekend",
  isActive: true,
  credentials: { /* ... */ }
}
```

**How it works:**
- System checks current day (Jakarta timezone)
- Selects appropriate sub-merchant based on schedule
- Falls back to `schedule: null` if no match
- Can be forced via `partnerClient.forceSchedule`

---

## Testing Configuration

### Sandbox/Staging Setup

**1. Create test sub-merchant:**
```javascript
db.sub_merchant.insertOne({
  name: "ING1 Wallet - Staging",
  provider: "ing1",
  merchantId: ObjectId("merchant_id"),
  credentials: {
    baseUrl: "https://staging-api.ing1.com",  // Staging URL
    email: "test@example.com",
    password: "test_password",
    productCode: "QRIS",
    callbackUrl: "http://localhost:5000/api/v1/payment/ing1/callback",
    permanentToken: "test_token",
    merchantId: "TEST_MERCHANT",
    apiVersion: "v2"
  },
  schedule: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
})
```

**2. Update partner client for testing:**
```javascript
db.partnerClient.updateOne(
  { email: "test@launcx.com" },
  { $set: { defaultProvider: "ing1" } }
)
```

**3. Test callbacks locally:**
```bash
# Use ngrok to expose local server
ngrok http 5000

# Update callback URL in sub_merchant
db.sub_merchant.updateOne(
  { name: "ING1 Wallet - Staging" },
  { $set: { "credentials.callbackUrl": "https://xxxx.ngrok.io/api/v1/payment/ing1/callback" } }
)
```

---

## Callback URL Configuration

### Payment Callbacks

ING1 will send payment status to:
```
{credentials.callbackUrl}?client_reff={orderId}&reff={ing1_ref}&rc={code}&status={status}&...
```

**Example:**
```
https://launcx.com/api/v1/payment/ing1/callback
  ?client_reff=order_123
  &reff=ING1_REF_456
  &rc=0
  &status=PAID
  &total=50000
  &paid_at=2025-10-19 10:30:00
```

### Withdrawal Callbacks

ING1 will send withdrawal status to:
```
{BASE_URL}/api/v1/withdrawals/ing1/callback?client_reff={refId}&reff={ing1_ref}&rc={code}&status={status}&...
```

**Example:**
```
https://launcx.com/api/v1/withdrawals/ing1/callback
  ?client_reff=wd-123
  &reff=ING1_WD_789
  &rc=0
  &status=SUCCESS
  &fee=2500
  &completed_at=2025-10-19 11:00:00
```

**Note:** Withdrawal callback URL is hardcoded in the route, not in credentials.

---

## Verification

### 1. Verify Sub-Merchant

```javascript
// Check sub-merchant exists and is active
db.sub_merchant.findOne({
  provider: "ing1",
  isActive: true
})
```

### 2. Verify Parent Merchant

```javascript
// Check parent merchant exists
db.merchant.findOne({ name: "ing1" })
```

### 3. Verify Partner Client

```javascript
// Check partner client has ING1 as default
db.partnerClient.findOne({
  _id: ObjectId("partner_id"),
  defaultProvider: "ing1"
})
```

### 4. Test API Connectivity

```bash
# Try creating a transaction
curl --location 'http://localhost:5000/api/v1/transactions' \
--header 'X-API-Key: your-api-key' \
--header 'Content-Type: application/json' \
--data '{
  "price": 10000,
  "playerId": "test_player"
}'
```

---

## Troubleshooting

### Issue: "No active provider found"

**Cause:** No active ING1 sub-merchant or wrong schedule

**Solutions:**
1. Check `isActive: true` in sub_merchant
2. Verify `schedule` matches current day
3. Check `merchantId` reference is correct
4. Try `forceSchedule` in partner client

```javascript
// Check active sub-merchants
db.sub_merchant.find({
  provider: "ing1",
  isActive: true
}).pretty()

// Force schedule
db.partnerClient.updateOne(
  { _id: ObjectId("partner_id") },
  { $set: { forceSchedule: null } }
)
```

### Issue: "Invalid credentials"

**Cause:** Wrong ING1 credentials or expired token

**Solutions:**
1. Verify credentials with ING1
2. Check API base URL
3. Test credentials directly with ING1 API
4. Regenerate permanent token

```javascript
// Update credentials
db.sub_merchant.updateOne(
  { provider: "ing1" },
  { $set: {
    "credentials.password": "new_password",
    "credentials.permanentToken": "new_token"
  }}
)
```

### Issue: "Callback not received"

**Cause:** Wrong callback URL or network issues

**Solutions:**
1. Verify callback URL is accessible
2. Check firewall/security settings
3. Test with ngrok for local development
4. Check ING1 dashboard for callback logs
5. Use fallback mechanism

```javascript
// Update callback URL
db.sub_merchant.updateOne(
  { provider: "ing1" },
  { $set: { "credentials.callbackUrl": "https://new-url.com/callback" } }
)
```

### Issue: "Provider selection error"

**Cause:** Multiple active providers with same schedule

**Solutions:**
1. Set specific schedule for each sub-merchant
2. Use only one active sub-merchant
3. Disable unused sub-merchants

```javascript
// Disable all except one
db.sub_merchant.updateMany(
  {
    provider: "ing1",
    _id: { $ne: ObjectId("keep_this_one") }
  },
  { $set: { isActive: false } }
)
```

---

## Security Best Practices

1. **Never commit credentials** to version control
2. **Use strong passwords** for ING1 accounts
3. **Rotate tokens regularly** (e.g., every 90 days)
4. **Restrict database access** to authorized personnel only
5. **Use HTTPS** for all callback URLs
6. **Encrypt sensitive fields** in database (if possible)
7. **Monitor access logs** for suspicious activity
8. **Implement IP whitelisting** for callbacks
9. **Keep API versions updated** to latest stable
10. **Backup credentials** securely offsite

---

## Migration Guide

### From Hilogate to ING1

```javascript
// 1. Create ING1 sub-merchant (as shown above)

// 2. Update partner client
db.partnerClient.updateOne(
  { _id: ObjectId("partner_id") },
  { $set: {
    defaultProvider: "ing1",  // Changed from "hilogate"
    updatedAt: new Date()
  }}
)

// 3. Test with small transaction

// 4. Monitor for issues

// 5. Disable old provider (optional)
db.sub_merchant.updateMany(
  { provider: "hilogate" },
  { $set: { isActive: false } }
)
```

---

## Reference

### Complete Example Configuration

```javascript
// 1. Merchant
{
  _id: ObjectId("671234567890abcdef123456"),
  name: "ing1"
}

// 2. Sub-Merchant
{
  _id: ObjectId("671234567890abcdef123457"),
  name: "ING1 Production Wallet",
  provider: "ing1",
  merchantId: ObjectId("671234567890abcdef123456"),
  credentials: {
    baseUrl: "https://api.ing1.com",
    email: "merchant@launcx.com",
    password: "SecurePassword123!",
    productCode: "QRIS",
    callbackUrl: "https://launcx.com/api/v1/payment/ing1/callback",
    permanentToken: "perm_token_abc123xyz789",
    merchantId: "ING1_LAUNCX_001",
    apiVersion: "v2"
  },
  schedule: null,
  isActive: true,
  createdAt: ISODate("2025-10-19T00:00:00Z"),
  updatedAt: ISODate("2025-10-19T00:00:00Z")
}

// 3. Partner Client
{
  _id: ObjectId("671234567890abcdef123458"),
  name: "Test Client",
  defaultProvider: "ing1",
  forceSchedule: null,
  feePercent: 2,
  feeFlat: 500,
  weekendFeePercent: 3,
  weekendFeeFlat: 750,
  withdrawFeePercent: 0.5,
  withdrawFeeFlat: 5000,
  balance: 0,
  callbackUrl: "https://client.com/launcx/callback",
  callbackSecret: "secret_abc123",
  createdAt: ISODate("2025-10-19T00:00:00Z"),
  updatedAt: ISODate("2025-10-19T00:00:00Z")
}

// 4. Client User
{
  _id: ObjectId("671234567890abcdef123459"),
  email: "user@client.com",
  passwordHash: "$2b$10$...",
  partnerClientId: ObjectId("671234567890abcdef123458"),
  totpEnabled: false,
  totpSecret: null,
  createdAt: ISODate("2025-10-19T00:00:00Z"),
  updatedAt: ISODate("2025-10-19T00:00:00Z")
}
```

---

**Last Updated:** October 2025
**Configuration Version:** 1.0
