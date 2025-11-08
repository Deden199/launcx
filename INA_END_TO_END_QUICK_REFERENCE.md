# INA End-to-End - Quick Reference Card

## 🎯 3-Step Overview

```
PAYMENT               WITHDRAWAL            SETTLEMENT
(Customer)           (Partner)             (Automatic)
──────────           ─────────             ──────────

1. Create Order  →  5. Request Wd  →      8. Check Status
2. Get QR Code   →  6. Validate    →      9. Settle Orders
3. Pay via INA   →  7. Execute     →     10. Update Balance
4. PAID Status   →  8. COMPLETED   →     11. Notify Telegram
```

---

## 📡 4 Main API Endpoints on YOUR Server

### 1. Create Payment Order
```bash
POST /api/v1/create-order
Header: x-api-key
Body: {price, buyer, merchantName="ing1", subMerchantId}
Response: {orderId, checkoutUrl, qrPayload}
```

### 2. Request Withdrawal
```bash
POST /api/v1/client/dashboard/withdraw
Header: Authorization: Bearer TOKEN
Body: {subMerchantId, sourceProvider="ing1", account_number, amount...}
Response: {refId, status}
```

### 3. Check Withdrawal Status
```bash
GET /api/v1/client/dashboard/withdrawals/:refId
Header: Authorization: Bearer TOKEN
Response: {status, amount, pgFee, bankName...}
```

### 4. Run Settlement (Manual for testing)
```bash
POST /api/v1/admin/settlement/run-manual
Header: Authorization: Bearer ADMIN_TOKEN
Body: {filters: {dateFrom, dateTo, paymentMethods: ["ing1"]}}
Response: {jobId, status}
```

---

## ✨ 10-Minute Quick Test

```bash
#!/bin/bash

# Setup
API="https://yourdomain.com"
KEY="your_api_key"
TOKEN="your_jwt_token"
SUB="sub_ing1_123"

# 1. CREATE PAYMENT (30 sec)
echo "1️⃣  Creating payment..."
PAY=$(curl -s -X POST "$API/api/v1/create-order" \
  -H "x-api-key: $KEY" \
  -d '{"price":100000,"buyer":"partner123","merchantName":"ing1","subMerchantId":"'$SUB'"}')
ORDER=$(echo "$PAY" | jq -r '.data.orderId')
echo "✅ Order: $ORDER"

# 2. SIMULATE PAYMENT (30 sec)
echo "2️⃣  Simulating customer payment..."
sleep 2
echo "✅ Customer paid"

# 3. REQUEST WITHDRAWAL (1 min)
echo "3️⃣  Requesting withdrawal..."
WD=$(curl -s -X POST "$API/api/v1/client/dashboard/withdraw" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"subMerchantId":"'$SUB'","sourceProvider":"ing1","account_number":"1234567890","bank_code":"002","account_name":"Test","bank_name":"BRI","amount":500000}')
REF=$(echo "$WD" | jq -r '.refId')
echo "✅ Withdrawal: $REF"

# 4. WAIT FOR COMPLETION (30 sec)
echo "4️⃣  Waiting for withdrawal completion..."
sleep 30
STATUS=$(curl -s -X GET "$API/api/v1/client/dashboard/withdrawals/$REF" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.status')
echo "✅ Status: $STATUS"

# 5. RUN SETTLEMENT (1 min)
echo "5️⃣  Running settlement..."
SETTLE=$(curl -s -X POST "$API/api/v1/admin/settlement/run-manual" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"filters":{"dateFrom":"2024-10-20","dateTo":"2024-10-24","paymentMethods":["ing1"]}}')
JOB=$(echo "$SETTLE" | jq -r '.jobId')
sleep 3
echo "✅ Settlement: $JOB"

echo ""
echo "🎉 END-TO-END TEST COMPLETE!"
```

---

## 📝 Copy-Paste Commands

### Create Payment
```bash
curl -X POST https://yourdomain.com/api/v1/create-order \
  -H "x-api-key: API_KEY" \
  -d '{"price":100000,"buyer":"partner123","merchantName":"ing1","subMerchantId":"sub_ing1_123"}'
```

### Request Withdrawal
```bash
curl -X POST https://yourdomain.com/api/v1/client/dashboard/withdraw \
  -H "Authorization: Bearer TOKEN" \
  -d '{"subMerchantId":"sub_ing1_123","sourceProvider":"ing1","account_number":"1234567890","bank_code":"002","account_name":"John","bank_name":"BRI","amount":500000}'
```

### Check Withdrawal Status
```bash
curl -X GET "https://yourdomain.com/api/v1/client/dashboard/withdrawals/wd-123" \
  -H "Authorization: Bearer TOKEN"
```

### Run Settlement
```bash
curl -X POST https://yourdomain.com/api/v1/admin/settlement/run-manual \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{"filters":{"dateFrom":"2024-10-20","dateTo":"2024-10-24","paymentMethods":["ing1"]}}'
```

---

## 🔄 Data Flow

```
PAYMENT SIDE                    DATABASE                WITHDRAWAL SIDE
─────────────                   ────────                ───────────────

Customer                        orders:                 Partner
    ↓                           status=PENDING          ↓
Create order        →           ↓
    ↓                           (Callback/Fallback)
Get QR Code         →           ↓
    ↓                           status=PAID
Pay via INA         →           ↓
    ↓                           (Settlement 4 PM)
Callback            →           ↓
                                status=SETTLED  ←      Check balance
                                ↓
                                (Balance++)      ←     Request withdrawal
                                                       ↓
                                withdrawRequests:      Validate account
                                status=PENDING    ←    (INA inquiry)
                                ↓
                                (Fallback/Callback)
                                ↓
                                status=COMPLETED ←     Money arrives
```

---

## 💰 Fee Breakdown Example

```
Payment: 100,000 IDR → Settlement: 100,000 IDR
Withdrawal: 500,000 IDR

Your fee: 500,000 × 1% = 5,000 IDR
INA fee: 6,500 IDR (from inquiry response)

Net to customer: 500,000 - 5,000 - 6,500 = 488,500 IDR
```

---

## ⏱️ Timing

```
Payment:
  - Create order: Immediate
  - Customer pays: Minutes
  - Callback: Minutes (or fallback: every 30s)
  - Settlement: Next day 4 PM

Withdrawal:
  - Request: Immediate
  - Validate: Seconds
  - Execute: Seconds
  - Completion: Minutes (via callback or fallback)

Settlement:
  - Runs: Daily 4 PM
  - Duration: 1-5 minutes (depends on order count)
  - Notification: Via Telegram
```

---

## 🔍 Status Values

### Payment Order
```
PENDING  → Created, waiting for payment
PAID     → Payment received from customer
SETTLED  → Settled to partner (next day)
```

### Withdrawal
```
PENDING    → Requested, processing
COMPLETED  → Successfully transferred
FAILED     → Transfer failed (balance refunded)
```

---

## 🛠️ Tools You Need

```bash
# Check if curl is available
curl --version

# Check if jq is available (JSON parsing)
jq --version

# If jq not installed:
# macOS:   brew install jq
# Linux:   apt-get install jq
# Windows: Use -X flag without jq for raw output
```

---

## 🚨 Common Issues

| Issue | Solution |
|-------|----------|
| Order not found | Check order ID is correct |
| Withdrawal fails | Verify bank account number |
| Status not updating | Wait 30+ seconds for fallback |
| Settlement didn't run | Check time is 4 PM or use manual endpoint |
| Balance not increased | Wait for settlement to complete |

---

## ✅ Success Indicators

- ✅ Order created with ID
- ✅ Payment shows status PAID
- ✅ Withdrawal shows status PENDING then COMPLETED
- ✅ Settlement job completed
- ✅ Order status changed to SETTLED
- ✅ Balance increased
- ✅ Telegram notification sent

---

## 📚 Related Docs

- **Full Details:** `INA_END_TO_END_CURL_WORKFLOW.md`
- **Payment Only:** `YOUR_INA_PAYMENT_INTEGRATION_CURL.md`
- **Withdrawal Only:** `INA_WITHDRAWAL_CURL_GUIDE.md`
- **Settlement Only:** `INACASH_SETTLEMENT_QUICK_REFERENCE.md`
- **Comparison:** `INA_VS_HILOGATE_ENDPOINT_COMPARISON.md`

---

## 🎯 Next Steps

1. Save the quick test script above
2. Replace API_KEY, TOKEN, SUB values
3. Run: `chmod +x test.sh && ./test.sh`
4. Watch the complete flow execute!

---

**Ready to test? Run the script above! 🚀**
