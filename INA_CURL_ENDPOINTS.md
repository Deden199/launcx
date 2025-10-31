# INA/ING1 cURL Endpoints - Complete Reference

## 🔐 Authentication

All INA endpoints require Bearer token authentication.

### Get Token (Login)
```bash
curl -X POST https://api.ing1.com/user/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "merchant@example.com",
    "password": "password123"
  }'

# Response:
# {
#   "rc": 0,
#   "message": "Success",
#   "data": {
#     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
#   }
# }
```

### Token Usage
```bash
# All endpoints use Bearer token
-H "Authorization: Bearer {token}"
```

---

## 💰 Cash-In (Payment Collection) Endpoints

### 1. Create Cash-In Transaction
```bash
curl -X POST https://api.ing1.com/transaction/cashin/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "product_code": "QRIS_DIRECT",
    "amount": 100000,
    "client_reff": "order_123456789",
    "remark": "Payment for Order #123",
    "expiry_time": "2024-10-25T16:00:00Z",
    "return_url": "https://yourdomain.com/callback",
    "merchant_id": "MERCHANT123"
  }'

# Response:
# {
#   "rc": 0,
#   "message": "Success",
#   "reff": "TRX20241024001",
#   "client_reff": "order_123456789",
#   "product_code": "QRIS_DIRECT",
#   "data": {
#     "payment_url": "https://billers.ing1.com/qris/TRX20241024001",
#     "content": "00020126360014....",  // QR Code content
#     "expired_at": "2024-10-25T16:00:00Z"
#   }
# }
```

### 2. Check Cash-In Status
```bash
curl -X POST https://api.ing1.com/transaction/cashin/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "reff": "TRX20241024001",
    "client_reff": "order_123456789"
  }'

# Response:
# {
#   "rc": 0,
#   "message": "Success",
#   "status": "PAID",
#   "reff": "TRX20241024001",
#   "client_reff": "order_123456789",
#   "product_code": "QRIS_DIRECT",
#   "data": {
#     "amount": 100000,
#     "paid_at": "2024-10-24T14:30:45Z",
#     "fee": 2500,
#     "receipt": "RCP123456"
#   }
# }
```

### 3. List Cash-In History
```bash
curl -X GET "https://api.ing1.com/transaction/cashin/history?page=1&per_page=20&start_date=2024-10-01&end_date=2024-10-31" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Response:
# {
#   "rc": 0,
#   "message": "Success",
#   "status": "PAID",
#   "histories": [
#     {
#       "reff": "TRX20241024001",
#       "client_reff": "order_123456789",
#       "amount": 100000,
#       "status": "SUCCESS",
#       "paid_at": "2024-10-24T14:30:45Z",
#       "created_at": "2024-10-24T14:00:00Z"
#     }
#   ],
#   "pagination": {
#     "current_page": 1,
#     "per_page": 20,
#     "total": 150,
#     "last_page": 8,
#     "has_next_page": true
#   }
# }
```

---

## 💸 Cash-Out (Withdrawal) Endpoints

### 1. Cashout Inquiry (Validate Account)
```bash
curl -X POST https://api.ing1.com/transaction/cashout/inquiry \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "bank_code": "BCA",
    "account_no": "1234567890",
    "amount": 500000,
    "client_reff": "withdrawal_123456",
    "customer_name": "John Doe",
    "remark": "Withdrawal to merchant account",
    "merchant_id": "MERCHANT123"
  }'

# Response:
# {
#   "rc": 0,
#   "message": "Success",
#   "status": "PAID",
#   "reff": "COUT20241024001",
#   "client_reff": "withdrawal_123456",
#   "data": {
#     "bank_code": "BCA",
#     "bank_name": "Bank Central Asia",
#     "account_number": "1234567890",
#     "account_name": "PT MERCHANT STORE",
#     "amount": 500000,
#     "fee": 6500
#   }
# }
```

### 2. Cashout Payment (Execute Withdrawal)
```bash
curl -X POST https://api.ing1.com/transaction/cashout/payment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "reff": "COUT20241024001",
    "client_reff": "withdrawal_123456",
    "amount": 500000,
    "otp": "123456",
    "remark": "Withdrawal to merchant account",
    "merchant_id": "MERCHANT123"
  }'

# Response:
# {
#   "rc": 0,
#   "message": "Success",
#   "status": "PAID",
#   "reff": "COUT20241024001",
#   "client_reff": "withdrawal_123456",
#   "data": {
#     "reference_number": "REF20241024001",
#     "status": "PROCESSING",
#     "amount": 500000
#   }
# }
```

### 3. Check Cashout Status
```bash
curl -X POST https://api.ing1.com/transaction/cashout/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "reff": "COUT20241024001",
    "client_reff": "withdrawal_123456"
  }'

# Response:
# {
#   "rc": 0,
#   "message": "Success",
#   "status": "PAID",
#   "reff": "COUT20241024001",
#   "client_reff": "withdrawal_123456",
#   "data": {
#     "status": "SUCCESS",
#     "amount": 500000,
#     "fee": 6500,
#     "payout_at": "2024-10-24T15:30:00Z"
#   }
# }
```

### 4. List Cashout History
```bash
curl -X GET "https://api.ing1.com/transaction/cashout/history?page=1&per_page=20&start_date=2024-10-01&end_date=2024-10-31" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Response:
# {
#   "rc": 0,
#   "message": "Success",
#   "status": "PAID",
#   "histories": [
#     {
#       "reff": "COUT20241024001",
#       "client_reff": "withdrawal_123456",
#       "bank_code": "BCA",
#       "bank_name": "Bank Central Asia",
#       "account_number": "1234567890",
#       "account_name": "PT MERCHANT STORE",
#       "amount": 500000,
#       "fee": 6500,
#       "status": "SUCCESS",
#       "payout_at": "2024-10-24T15:30:00Z",
#       "created_at": "2024-10-24T14:00:00Z"
#     }
#   ],
#   "pagination": {
#     "current_page": 1,
#     "per_page": 20,
#     "total": 45,
#     "last_page": 3
#   }
# }
```

---

## 🏦 Bank Information Endpoints

### 1. Get Supported Banks (Product List)
```bash
curl -X GET https://api.ing1.com/product \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Response:
# {
#   "rc": 0,
#   "message": "Success",
#   "data": [
#     {
#       "code": "TRF_BCA",
#       "name": "Bank Central Asia",
#       "category": "BANK_TRANSFER",
#       "status": "ACTIVE"
#     },
#     {
#       "code": "TRF_BNI",
#       "name": "Bank Negara Indonesia",
#       "category": "BANK_TRANSFER",
#       "status": "ACTIVE"
#     },
#     {
#       "code": "TRF_MANDIRI",
#       "name": "Bank Mandiri",
#       "category": "BANK_TRANSFER",
#       "status": "ACTIVE"
#     },
#     {
#       "code": "QRIS_DIRECT",
#       "name": "QRIS Direct",
#       "category": "PAYMENT",
#       "status": "ACTIVE"
#     }
#   ]
# }
```

---

## 🔧 Utility Functions for cURL

### Save Token to Variable
```bash
# Login and save token
TOKEN=$(curl -s -X POST https://api.ing1.com/user/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "merchant@example.com",
    "password": "password123"
  }' | jq -r '.data.token')

echo "Token: $TOKEN"
```

### Check Cash-In Status (Using Saved Token)
```bash
TOKEN="your_token_here"
REFF="TRX20241024001"

curl -X POST https://api.ing1.com/transaction/cashin/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"reff\": \"$REFF\",
    \"client_reff\": \"order_123456789\"
  }"
```

### Pretty Print Response
```bash
TOKEN="your_token_here"

curl -s -X GET https://api.ing1.com/transaction/cashin/history?page=1 \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

---

## 📝 Settlement-Related cURL

### Check Payment Status for Settlement
```bash
# This is what the settlement cron job calls
TOKEN="your_token_here"
ORDER_ID="order_123456789"

curl -X POST https://api.ing1.com/transaction/cashin/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"reff\": \"$ORDER_ID\"
  }"

# If rc=0 and status=PAID, order is ready for settlement
# Extract: data.amount (settlement amount), reff (reference), data.paid_at (time)
```

### Full Settlement Check Script
```bash
#!/bin/bash

# Configuration
EMAIL="merchant@example.com"
PASSWORD="password123"
ORDER_ID="order_123456789"
API_BASE="https://api.ing1.com"

# Step 1: Get token
echo "🔐 Getting token..."
TOKEN=$(curl -s -X POST "$API_BASE/user/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$EMAIL\",
    \"password\": \"$PASSWORD\"
  }" | jq -r '.data.token')

echo "Token: ${TOKEN:0:20}..."

# Step 2: Check payment status
echo "🔍 Checking payment status for $ORDER_ID..."
RESPONSE=$(curl -s -X POST "$API_BASE/transaction/cashin/check" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"reff\": \"$ORDER_ID\"
  }")

echo "Response:"
echo "$RESPONSE" | jq '.'

# Step 3: Extract settlement details
RC=$(echo "$RESPONSE" | jq -r '.rc')
STATUS=$(echo "$RESPONSE" | jq -r '.status')
AMOUNT=$(echo "$RESPONSE" | jq -r '.data.amount')
PAID_AT=$(echo "$RESPONSE" | jq -r '.data.paid_at')

if [ "$RC" = "0" ] && [ "$STATUS" = "PAID" ]; then
  echo "✅ Order is ready for settlement!"
  echo "   Amount: $AMOUNT"
  echo "   Paid at: $PAID_AT"
else
  echo "❌ Order is not settled yet"
fi
```

---

## 🧪 Test Scenarios

### Scenario 1: Create Payment & Check Status
```bash
#!/bin/bash

API="https://api.ing1.com"
EMAIL="merchant@example.com"
PASSWORD="password123"

# Get token
TOKEN=$(curl -s -X POST "$API/user/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL\", \"password\": \"$PASSWORD\"}" \
  | jq -r '.data.token')

# Create payment
echo "Creating payment..."
CREATE=$(curl -s -X POST "$API/transaction/cashin/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "product_code": "QRIS_DIRECT",
    "amount": 50000,
    "client_reff": "test_'$(date +%s)'",
    "return_url": "https://yourdomain.com/callback"
  }')

REFF=$(echo "$CREATE" | jq -r '.reff')
echo "Payment created: $REFF"
echo "Payment URL: $(echo "$CREATE" | jq -r '.data.payment_url')"
echo "QR Code: $(echo "$CREATE" | jq -r '.data.content')"

# Check status
sleep 2
echo "Checking status..."
curl -s -X POST "$API/transaction/cashin/check" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"reff\": \"$REFF\"}" | jq '.data'
```

### Scenario 2: Withdrawal Process
```bash
#!/bin/bash

API="https://api.ing1.com"
TOKEN="your_token_here"

# Step 1: Inquiry (validate account)
echo "1️⃣ Validating account..."
INQUIRY=$(curl -s -X POST "$API/transaction/cashout/inquiry" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "bank_code": "BCA",
    "account_no": "1234567890",
    "amount": 500000,
    "client_reff": "withdraw_'$(date +%s)'"
  }')

REFF=$(echo "$INQUIRY" | jq -r '.reff')
FEE=$(echo "$INQUIRY" | jq -r '.data.fee')
echo "Account valid. Reference: $REFF, Fee: $FEE"

# Step 2: Execute payment
echo "2️⃣ Executing withdrawal..."
PAYMENT=$(curl -s -X POST "$API/transaction/cashout/payment" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"reff\": \"$REFF\",
    \"amount\": 500000,
    \"otp\": \"123456\"
  }")

echo "Withdrawal initiated:"
echo "$PAYMENT" | jq '.data'

# Step 3: Check status
sleep 2
echo "3️⃣ Checking status..."
curl -s -X POST "$API/transaction/cashout/check" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"reff\": \"$REFF\"}" | jq '.data'
```

---

## 📊 Response Codes

| RC | Status | Meaning |
|----|--------|---------|
| 0 | SUCCESS | Operation successful |
| 91 | PENDING | Transaction pending |
| 98 | EXPIRED_TOKEN | Token expired, need to refresh |
| 99 | FAILED | Operation failed |

---

## 🔑 Common Parameters

### Cash-In Parameters
```
product_code    : QRIS_DIRECT (or other product)
amount          : Amount in IDR (integer)
client_reff     : Your unique reference (string, required)
remark          : Transaction description (optional)
expiry_time     : ISO 8601 timestamp (optional)
return_url      : Callback URL (optional)
merchant_id     : Merchant identifier (optional)
```

### Cash-Out Parameters
```
bank_code       : Bank code (BCA, BNI, MANDIRI, etc.)
account_no      : Bank account number
amount          : Amount in IDR (integer)
client_reff     : Your unique reference (required)
customer_name   : Account holder name (optional)
remark          : Withdrawal reason (optional)
merchant_id     : Merchant identifier (optional)
```

---

## 🛡️ Error Handling in cURL

### Check for Errors
```bash
curl -s -X POST https://api.ing1.com/transaction/cashin/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reff": "TRX123"}' | jq '{rc, message, status}'

# Output example:
# {
#   "rc": 0,
#   "message": "Success",
#   "status": "PAID"
# }
```

### Retry on Token Expiration
```bash
#!/bin/bash

make_request() {
  local TOKEN=$1
  local ENDPOINT=$2
  local DATA=$3

  RESPONSE=$(curl -s -X POST "https://api.ing1.com$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$DATA")

  RC=$(echo "$RESPONSE" | jq -r '.rc')

  if [ "$RC" = "98" ]; then
    echo "Token expired, refreshing..."
    TOKEN=$(curl -s -X POST https://api.ing1.com/user/login \
      -H "Content-Type: application/json" \
      -d '{"email":"...","password":"..."}' | jq -r '.data.token')

    # Retry
    curl -s -X POST "https://api.ing1.com$ENDPOINT" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "$DATA"
  else
    echo "$RESPONSE"
  fi
}
```

---

## 📈 Real-World Settlement Example

### Full Settlement Flow with cURL
```bash
#!/bin/bash

# Configuration
API="https://api.ing1.com"
EMAIL="merchant@example.com"
PASSWORD="password123"

# Orders to settle (simulate from database)
ORDERS=("order_001" "order_002" "order_003")

# Get token
echo "🔐 Authenticating..."
TOKEN=$(curl -s -X POST "$API/user/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL\", \"password\": \"$PASSWORD\"}" \
  | jq -r '.data.token')

# Process each order
SETTLED_COUNT=0
TOTAL_AMOUNT=0

for ORDER_ID in "${ORDERS[@]}"; do
  echo "Checking $ORDER_ID..."

  # Check payment status
  RESPONSE=$(curl -s -X POST "$API/transaction/cashin/check" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"reff\": \"$ORDER_ID\"}")

  RC=$(echo "$RESPONSE" | jq -r '.rc')
  STATUS=$(echo "$RESPONSE" | jq -r '.status')
  AMOUNT=$(echo "$RESPONSE" | jq -r '.data.amount // 0')

  if [ "$RC" = "0" ] && [ "$STATUS" = "PAID" ]; then
    echo "✅ $ORDER_ID settled for $AMOUNT IDR"
    ((SETTLED_COUNT++))
    TOTAL_AMOUNT=$((TOTAL_AMOUNT + AMOUNT))
  else
    echo "❌ $ORDER_ID not settled yet"
  fi
done

echo ""
echo "Settlement Summary:"
echo "- Settled orders: $SETTLED_COUNT"
echo "- Total amount: $TOTAL_AMOUNT IDR"
```

---

## 🎯 Summary

### Key Endpoints for Settlement
```
POST /user/login                      - Get authentication token
POST /transaction/cashin/check        - Check payment status (FOR SETTLEMENT)
GET  /transaction/cashin/history      - List payments
POST /transaction/cashout/inquiry     - Validate account
POST /transaction/cashout/payment     - Execute withdrawal
POST /transaction/cashout/check       - Check withdrawal status
GET  /product                         - Get supported banks
```

### For Settlement Cron Job
You only need:
1. **POST /user/login** - Get token at start
2. **POST /transaction/cashin/check** - Check if payment is PAID
3. Extract: `data.amount`, `reff`, `data.paid_at`
4. Update database

The settlement implementation already does this! ✅
