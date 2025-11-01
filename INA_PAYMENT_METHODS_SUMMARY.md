# INA Payment (ING1) - Payment Methods Summary

**Date**: 2025-10-22
**Provider**: INA (ING1 Biller Engine)
**API Version**: v2

---

## ⚠️ CRITICAL INFORMATION

### What INA/ING1 DOES Support
- ✅ **QRIS** - QR Code payments (primary method)
- ✅ **Bank Transfer** - Only via withdrawal/cashout endpoint (not payment)

### What INA/ING1 DOES NOT Support
- ❌ **Virtual Account (VA)** - BCA VA, Mandiri VA, BNI VA - NOT SUPPORTED
- ❌ **E-Wallet** - GoPay, OVO, DANA, LinkAja, Jeniuspay - NOT SUPPORTED
- ❌ **Credit/Debit Card** - NOT SUPPORTED
- ❌ **Other payment methods** - NOT SUPPORTED

---

## Payment Methods

### 1. QRIS (✅ SUPPORTED FOR PAYMENTS)

**What is QRIS?**
QR Code Indonesian Standard - a unified QR code that works with any bank or e-wallet in Indonesia.

**When customer pays:**
- Customer scans QR code with any bank app or e-wallet (GoPay, OVO, DANA, etc.)
- Funds sent directly to merchant account
- Instant settlement available

**Product Code**: `QRIS_DIRECT` or `QRIS`

**Example CURL:**
```bash
curl -X POST 'http://localhost:3000/api/v1/transactions' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "merchantName": "ing1",
    "price": 50000,
    "playerId": "player_123",
    "paymentChannel": "qris"
  }'
```

**Response includes:**
- QR code payload (scannable by customer)
- Payment URL (can be embedded or redirected)
- Expiration time
- Order ID for tracking

**Best For:**
- Quick checkout
- Any e-wallet user
- Mobile payments
- High-volume transactions

---

### 2. Bank Transfer (✅ SUPPORTED FOR WITHDRAWALS ONLY)

**IMPORTANT**: Bank transfer with INA is ONLY available for **withdrawals/payouts**, NOT for customer payments.

**For customer payments**: Use QRIS instead.

**When merchant withdraws:**
- Two-step process: Validate account → Execute transfer
- Destination: Any bank in Indonesia
- Settlement: Usually same day

**Supported Banks**: BCA, BRI, Mandiri, BNI, CIMB, and 20+ other banks

**Example CURL (Withdrawal):**
```bash
# Step 1: Validate
curl -X POST 'http://localhost:3000/api/v1/client/withdrawals/validate' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "account_number": "1234567890",
    "bank_code": "014",
    "sourceProvider": "ing1",
    "amount": 50000
  }'

# Step 2: Withdraw
curl -X POST 'http://localhost:3000/api/v1/client/withdrawals' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "subMerchantId": "ID",
    "sourceProvider": "ing1",
    "account_number": "1234567890",
    "bank_code": "014",
    "amount": 50000,
    "account_name": "JOHN DOE",
    "bank_name": "Bank Central Asia"
  }'
```

**Best For:**
- Merchant payouts
- Settlement transfers
- Multi-account distributions
- High-volume withdrawals

---

## What to Use INSTEAD

### ❌ Customer wants to pay via Virtual Account (BCA, Mandiri, BNI)
**Use**: OY Indonesia or Hilogate instead
- These providers support VA payment method
- INA/ING1 does NOT support VA

### ❌ Customer wants to pay via E-Wallet (GoPay, OVO, DANA, LinkAja)
**Use**: OY Indonesia instead
- OY has direct e-wallet integrations
- Customers can specify wallet
- INA/ING1 only supports QRIS for e-wallets

**OR**: Use QRIS with INA
- QRIS works with any e-wallet
- Customer chooses wallet during payment
- Works with ING1

### ❌ Customer wants to pay via Credit/Debit Card
**Use**: Pivot or Genesis instead
- These providers support 3DS card payments
- INA/ING1 does NOT support cards

---

## Configuration Checklist

### In Database (MongoDB)

```javascript
// Create sub-merchant
db.sub_merchant.insertOne({
  name: "ING1 Wallet",
  provider: "ing1",
  credentials: {
    baseUrl: "https://api.ing1.com",
    email: "your-email@example.com",
    password: "your-password",
    productCode: "QRIS_DIRECT",  // ← Always QRIS_DIRECT
    merchantId: "YOUR_MERCHANT_ID",
    permanentToken: "token_here",
    callbackUrl: "https://yourdomain.com/api/v1/payment/ing1/callback",
    apiVersion: "v2"
  },
  isActive: true
})

// Set as default provider
db.partnerClient.updateOne(
  { _id: ObjectId("partner_id") },
  { $set: { defaultProvider: "ing1" } }
)
```

### In Payment Request

```javascript
{
  "merchantName": "ing1",           // ← Must be "ing1"
  "price": 50000,                   // Amount in IDR
  "playerId": "player_123",
  "paymentChannel": "qris",         // ← Only valid channel for payments
  "customerEmail": "customer@email.com",
  "customerPhone": "081234567890"
}
```

---

## Error Scenarios

### Scenario 1: Customer Tries to Pay with Virtual Account

```bash
# ❌ WILL NOT WORK
curl -X POST 'http://localhost:3000/api/v1/transactions' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "merchantName": "ing1",
    "paymentChannel": "va_bca",   # ← INA does NOT support VA
    "price": 50000
  }'

# Error Response:
# rc: 99
# message: "Invalid payment channel for INA provider"
```

**Solution**: Use OY Indonesia for VA or use QRIS with INA

### Scenario 2: Customer Tries to Pay with E-Wallet

```bash
# ❌ WILL NOT WORK (direct e-wallet)
curl -X POST 'http://localhost:3000/api/v1/transactions' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "merchantName": "ing1",
    "paymentChannel": "gopay",    # ← INA does NOT support GoPay directly
    "price": 50000
  }'

# Error Response:
# rc: 99
# message: "Invalid payment channel for INA provider"

# ✅ SOLUTION: Use QRIS instead
curl -X POST 'http://localhost:3000/api/v1/transactions' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "merchantName": "ing1",
    "paymentChannel": "qris",      # ← QRIS works with GoPay, OVO, DANA, etc.
    "price": 50000
  }'

# Customer will scan QRIS and choose their wallet
```

### Scenario 3: Using INA for Bank Transfer Payments

```bash
# ❌ WILL NOT WORK (bank transfer for payment)
curl -X POST 'http://localhost:3000/api/v1/transactions' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "merchantName": "ing1",
    "paymentChannel": "bank",      # ← Cannot use for customer payments
    "price": 50000
  }'

# Error Response:
# rc: 99
# message: "Invalid payment channel for INA provider"

# ✅ SOLUTION: Use Hilogate for bank transfer payments
curl -X POST 'http://localhost:3000/api/v1/transactions' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "merchantName": "hilogate",
    "paymentChannel": "bank_transfer",
    "price": 50000
  }'

# For INA bank transfers, use withdrawal endpoint instead
```

---

## Comparison with Other Providers

| Feature | INA/ING1 | OY Indonesia | Hilogate |
|---------|----------|--------------|----------|
| **QRIS** | ✅ | ✅ | ✅ |
| **BCA VA** | ❌ | ✅ | ✅ |
| **Mandiri VA** | ❌ | ✅ | ✅ |
| **BNI VA** | ❌ | ✅ | ✅ |
| **GoPay** | ❌ | ✅ | ❌ |
| **OVO** | ❌ | ✅ | ❌ |
| **DANA** | ❌ | ✅ | ❌ |
| **LinkAja** | ❌ | ✅ | ❌ |
| **Bank Transfer (Payment)** | ❌ | ❌ | ✅ |
| **Bank Transfer (Withdrawal)** | ✅ | ❌ | ❌ |
| **Best For** | Quick QRIS + Payouts | Multi-method | Bank transfers |

---

## When to Use INA/ING1

### ✅ USE INA when:
1. You only need QRIS payments
2. You need bank transfer withdrawals
3. You want to minimize provider count
4. Customer base prefers QRIS scanning
5. You need fast QRIS processing

### ❌ DON'T USE INA when:
1. Customers need Virtual Account option
2. You need specific e-wallet support (GoPay, OVO, etc.)
3. You need credit card payments
4. You want maximum payment method coverage

---

## Quick Reference URLs

### Documentation
- **Full INA Guide**: [INA_ING1_BILLER_ENGINE_API.md](./INA_ING1_BILLER_ENGINE_API.md)
- **All Payment Methods**: [PAYMENT_METHODS_CURL.md](./PAYMENT_METHODS_CURL.md)
- **INA Provider Docs**: `docs/providers/ing1/README.md`
- **INA Quick Start**: `docs/providers/ing1/QUICK_START.md`

### Implementation Files
- **INA Client**: `src/service/ing1Client.ts`
- **Status Mapping**: `src/service/ing1Status.ts`
- **Fallback Handler**: `src/service/ing1Fallback.ts`
- **Payment Controller**: `src/controller/payment.ts`

---

## Testing

### Test Payment with QRIS
```bash
curl -X POST 'http://localhost:3000/api/v1/transactions' \
  -H 'X-API-Key: TEST_KEY' \
  -d '{
    "merchantName": "ing1",
    "price": 10000,
    "playerId": "test_player_1"
  }'
```

### Test Withdrawal
```bash
# Validate
curl -X POST 'http://localhost:3000/api/v1/client/withdrawals/validate' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "account_number": "1234567890",
    "bank_code": "014",
    "sourceProvider": "ing1",
    "amount": 50000
  }'

# Withdraw
curl -X POST 'http://localhost:3000/api/v1/client/withdrawals' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "subMerchantId": "sub_merchant_id",
    "sourceProvider": "ing1",
    "account_number": "1234567890",
    "bank_code": "014",
    "amount": 50000,
    "account_name": "TEST USER",
    "bank_name": "BCA"
  }'
```

---

## Support & Troubleshooting

**Issue**: "Invalid payment channel"
- **Cause**: Using unsupported channel (VA, e-wallet, card)
- **Solution**: Use "qris" for payments or OY Indonesia for other methods

**Issue**: "Product code required"
- **Cause**: Missing productCode in sub-merchant credentials
- **Solution**: Set `productCode: "QRIS_DIRECT"` in credentials

**Issue**: "Bank transfer failed for payment"
- **Cause**: Trying to use bank transfer for customer payment
- **Solution**: Use QRIS for payment, use withdrawal endpoint for transfers

---

**Last Updated**: 2025-10-22
**Status**: Complete ✅
**Accuracy**: Based on ING1 Biller Engine API v2 Documentation

For complete API documentation, see: **INA_ING1_BILLER_ENGINE_API.md**
