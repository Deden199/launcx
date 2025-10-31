# INA cURL Cheatsheet - Copy & Paste Ready

## 🚀 Quick Copy-Paste Commands

### 1. Login
```bash
curl -X POST https://api.ing1.com/user/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@example.com","password":"password123"}'
```

**Save token:**
```bash
TOKEN=$(curl -s -X POST https://api.ing1.com/user/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@example.com","password":"password123"}' | jq -r '.data.token')
```

---

### 2. Create Cash-In (QRIS Payment)
```bash
curl -X POST https://api.ing1.com/transaction/cashin/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "product_code": "QRIS_DIRECT",
    "amount": 100000,
    "client_reff": "order_123456789",
    "remark": "Payment for Order",
    "return_url": "https://yourdomain.com/callback"
  }'
```

---

### 3. Check Payment Status ⭐ FOR SETTLEMENT
```bash
curl -X POST https://api.ing1.com/transaction/cashin/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reff":"order_123456789"}'
```

**With client_reff:**
```bash
curl -X POST https://api.ing1.com/transaction/cashin/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "reff": "order_123456789",
    "client_reff": "order_123456789"
  }'
```

---

### 4. List Cash-In History
```bash
curl -X GET "https://api.ing1.com/transaction/cashin/history?page=1&per_page=20" \
  -H "Authorization: Bearer $TOKEN"
```

**With date range:**
```bash
curl -X GET "https://api.ing1.com/transaction/cashin/history?page=1&per_page=20&start_date=2024-10-01&end_date=2024-10-31" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 5. Validate Bank Account (Cashout Inquiry)
```bash
curl -X POST https://api.ing1.com/transaction/cashout/inquiry \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "bank_code": "BCA",
    "account_no": "1234567890",
    "amount": 500000,
    "client_reff": "withdraw_123456",
    "customer_name": "John Doe"
  }'
```

---

### 6. Execute Withdrawal (Cashout Payment)
```bash
curl -X POST https://api.ing1.com/transaction/cashout/payment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "reff": "COUT20241024001",
    "amount": 500000,
    "otp": "123456"
  }'
```

---

### 7. Check Withdrawal Status
```bash
curl -X POST https://api.ing1.com/transaction/cashout/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reff":"COUT20241024001"}'
```

---

### 8. List Withdrawal History
```bash
curl -X GET "https://api.ing1.com/transaction/cashout/history?page=1&per_page=20" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 9. Get Supported Banks
```bash
curl -X GET https://api.ing1.com/product \
  -H "Authorization: Bearer $TOKEN"
```

---

## 📊 Settlement Quick Bash Script

```bash
#!/bin/bash

# Config
EMAIL="merchant@example.com"
PASSWORD="password123"
ORDER_IDS=("order_001" "order_002" "order_003")

# Login
TOKEN=$(curl -s -X POST https://api.ing1.com/user/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | jq -r '.data.token')

echo "Token: ${TOKEN:0:20}..."

# Check each order
SETTLED=0
TOTAL=0

for ORDER_ID in "${ORDER_IDS[@]}"; do
  RESP=$(curl -s -X POST https://api.ing1.com/transaction/cashin/check \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"reff\":\"$ORDER_ID\"}")

  RC=$(echo "$RESP" | jq -r '.rc')
  STATUS=$(echo "$RESP" | jq -r '.status')
  AMOUNT=$(echo "$RESP" | jq -r '.data.amount // 0')

  if [ "$RC" = "0" ] && [ "$STATUS" = "PAID" ]; then
    echo "✅ $ORDER_ID: SETTLED ($AMOUNT IDR)"
    ((SETTLED++))
    TOTAL=$((TOTAL + AMOUNT))
  else
    echo "❌ $ORDER_ID: NOT SETTLED"
  fi
done

echo "Total settled: $SETTLED / ${#ORDER_IDS[@]}"
echo "Total amount: $TOTAL IDR"
```

---

## 🔧 Extract Response Values

### Pretty Print
```bash
curl -s ... | jq '.'
```

### Get Specific Field
```bash
curl -s ... | jq '.data.amount'
curl -s ... | jq '.reff'
curl -s ... | jq '.status'
```

### Get Multiple Fields
```bash
curl -s ... | jq '{amount: .data.amount, reff: .reff, status: .status}'
```

### Check Response Code
```bash
curl -s ... | jq '.rc'
# Output: 0 (success), 91 (pending), 99 (failed)
```

---

## 🔐 Token Management

### Check Token Expiry
```bash
TOKEN="your_token_here"
echo "$TOKEN" | jq -R 'split(".")[1] | @base64d | fromjson | .exp'
```

### Refresh Token
```bash
NEW_TOKEN=$(curl -s -X POST https://api.ing1.com/user/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@example.com","password":"password123"}' \
  | jq -r '.data.token')

TOKEN=$NEW_TOKEN
```

---

## 📋 All Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/user/login` | POST | Get authentication token |
| `/transaction/cashin/create` | POST | Create QRIS payment |
| `/transaction/cashin/check` | POST | Check payment status ⭐ |
| `/transaction/cashin/history` | GET | List payments |
| `/transaction/cashout/inquiry` | POST | Validate account |
| `/transaction/cashout/payment` | POST | Execute withdrawal |
| `/transaction/cashout/check` | POST | Check withdrawal |
| `/transaction/cashout/history` | GET | List withdrawals |
| `/product` | GET | Get supported banks |

---

## 🧪 Test Endpoints

### Sandbox (Test)
```bash
API_BASE="https://sandbox-api.ing1.com"
```

### Production (Live)
```bash
API_BASE="https://api.ing1.com"
```

Replace `https://api.ing1.com` with `$API_BASE` in commands above.

---

## 📌 Important Response Fields

### Cash-In Check (Settlement)
```json
{
  "rc": 0,              // ← Must be 0
  "status": "PAID",     // ← Must be PAID
  "reff": "TRX123",     // ← Use as RRN
  "data": {
    "amount": 100000,   // ← Settlement amount
    "paid_at": "2024...", // ← Settlement time
    "fee": 2500         // ← Optional fee
  }
}
```

### Settlement Decision
```bash
if rc=0 AND status=PAID:
  ✅ Ready to settle
  - Use: amount, reff, paid_at
else:
  ❌ Not ready, skip
```

---

## 🎯 For Settlement Cron Job Only

You only need these 2 commands:

### 1. Get Token (Once at start)
```bash
TOKEN=$(curl -s -X POST https://api.ing1.com/user/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@example.com","password":"password123"}' \
  | jq -r '.data.token')
```

### 2. Check Each Order
```bash
curl -s -X POST https://api.ing1.com/transaction/cashin/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reff":"order_id"}' | jq '.'
```

That's it! 🎉

The settlement code already does this automatically.

---

## ⚡ One-Liner Examples

### Check 10 orders quickly
```bash
TOKEN=$(curl -s -X POST https://api.ing1.com/user/login -H "Content-Type: application/json" -d '{"email":"merchant@example.com","password":"password123"}' | jq -r '.data.token'); for i in {1..10}; do echo -n "order_$i: "; curl -s -X POST https://api.ing1.com/transaction/cashin/check -H "Authorization: Bearer $TOKEN" -d "{\"reff\":\"order_$i\"}" | jq -r '.status'; done
```

### Check specific order with amount
```bash
TOKEN=$(curl -s -X POST https://api.ing1.com/user/login -H "Content-Type: application/json" -d '{"email":"merchant@example.com","password":"password123"}' | jq -r '.data.token'); curl -s -X POST https://api.ing1.com/transaction/cashin/check -H "Authorization: Bearer $TOKEN" -d '{"reff":"order_123"}' | jq '{status:.status, amount:.data.amount, paid:.data.paid_at}'
```

---

## 🛠️ Troubleshooting cURL

### Add Verbose Output
```bash
curl -v -X POST https://api.ing1.com/transaction/cashin/check \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reff":"order_id"}'
```

### Check Response Headers
```bash
curl -i -X POST https://api.ing1.com/transaction/cashin/check \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reff":"order_id"}'
```

### Test Connectivity
```bash
curl -v https://api.ing1.com/product
```

### Check Token Valid
```bash
curl -X GET https://api.ing1.com/product \
  -H "Authorization: Bearer $TOKEN"
# Should return 200 if token is valid
```

---

## 📱 Real-World Workflow

```bash
#!/bin/bash

set -e  # Exit on error

# 1. Login
echo "🔐 Logging in..."
TOKEN=$(curl -s -X POST https://api.ing1.com/user/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@example.com","password":"password123"}' \
  | jq -r '.data.token')

# 2. Create payment
echo "💳 Creating payment..."
PAYMENT=$(curl -s -X POST https://api.ing1.com/transaction/cashin/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "product_code":"QRIS_DIRECT",
    "amount":50000,
    "client_reff":"test_'$(date +%s)'"
  }')

REFF=$(echo "$PAYMENT" | jq -r '.reff')
echo "Payment created: $REFF"
echo "URL: $(echo "$PAYMENT" | jq -r '.data.payment_url')"

# 3. Check status (simulate payment)
echo "⏳ Checking status..."
sleep 2

# 4. Check payment
STATUS=$(curl -s -X POST https://api.ing1.com/transaction/cashin/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"reff\":\"$REFF\"}")

RC=$(echo "$STATUS" | jq -r '.rc')
STATE=$(echo "$STATUS" | jq -r '.status')

if [ "$RC" = "0" ] && [ "$STATE" = "PAID" ]; then
  echo "✅ Payment confirmed!"
  echo "Amount: $(echo "$STATUS" | jq -r '.data.amount')"
else
  echo "⏳ Payment pending (expected)"
  echo "Status: $STATE"
fi
```

---

## ✅ Checklist for Settlement

- [ ] Can login to INA API
- [ ] Can check payment status
- [ ] Can extract amount from response
- [ ] Can extract reff from response
- [ ] Can extract paid_at from response
- [ ] Cron job configured
- [ ] Orders have correct channel
- [ ] Credentials in sub_merchant

**Once all checked, settlement runs automatically!** 🎉

---

## 📚 See Also

- `INA_CURL_ENDPOINTS.md` - Complete endpoint reference
- `INA_SETTLEMENT_CURL_COMMANDS.md` - Settlement-specific commands
- `INACASH_SETTLEMENT_GUIDE.md` - Integration guide
- `src/service/inacashSettlement.service.ts` - Implementation code
- `src/cron/settlement.ts` - Cron job code
