# INA End-to-End cURL Workflow - Payment → Withdrawal → Settlement

## 🎯 Complete Flow Overview

```
Customer Payment Flow                   Partner Withdrawal Flow            Daily Settlement
─────────────────────────────────────────────────────────────────────────────────────────

1. Create Payment Order        →        5. Request Withdrawal       →      8. Settlement Runs
   (Partner API)                          (Partner Dashboard)                (Automatic 4 PM)
        ↓                                      ↓                                  ↓
2. Get QR Code & Checkout      →        6. Account Validation      →      9. Update Orders
   (Return to customer)                    (INA Inquiry)                      (PAID → SETTLED)
        ↓                                      ↓                                  ↓
3. Customer Pays               →        7. Execute Payment        →      10. Increment Balance
   (Via INA/QRIS)                         (INA Cashout)                      (Partner balance++)
        ↓                                      ↓
4. Payment Callback            →        Money arrives at bank
   (Status: PAID)
```

---

## 📚 What You'll Need

### Configuration
```bash
# Your API
API_DOMAIN="https://yourdomain.com"
API_KEY="your_api_key_here"
PARTNER_TOKEN="your_jwt_token"

# Sub-merchant (has INA credentials)
SUB_MERCHANT_ID="sub_ing1_123"

# Partner client
PARTNER_CLIENT_ID="partner_client_123"
PARTNER_USER_ID="user_456"
```

---

## 🚀 PART 1: PAYMENT FLOW (End-to-End)

### Step 1a: Create Payment Order (Your API)

```bash
#!/bin/bash

# Configuration
API_KEY="your_api_key_here"
API_DOMAIN="https://yourdomain.com"
SUB_MERCHANT_ID="sub_ing1_123"
PARTNER_CLIENT_ID="partner_client_123"

# Create payment order
echo "=== Step 1: Creating Payment Order ==="
PAYMENT_RESPONSE=$(curl -s -X POST "$API_DOMAIN/api/v1/create-order" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "price": 100000,
    "playerId": "customer_123",
    "buyer": "'$PARTNER_CLIENT_ID'",
    "merchantName": "ing1",
    "flow": "embed",
    "subMerchantId": "'$SUB_MERCHANT_ID'",
    "sourceProvider": "ing1",
    "transactionDescription": "Payment for Game Credit",
    "customerEmail": "customer@example.com",
    "customerFullName": "John Customer",
    "customerPhone": "081234567890",
    "paymentChannel": "QRIS",
    "expiredTime": 3600
  }')

# Extract response data
ORDER_ID=$(echo "$PAYMENT_RESPONSE" | jq -r '.data.orderId')
CHECKOUT_URL=$(echo "$PAYMENT_RESPONSE" | jq -r '.data.checkoutUrl')
QR_PAYLOAD=$(echo "$PAYMENT_RESPONSE" | jq -r '.data.qrPayload')
TOTAL_AMOUNT=$(echo "$PAYMENT_RESPONSE" | jq -r '.data.totalAmount')
EXPIRED_TS=$(echo "$PAYMENT_RESPONSE" | jq -r '.data.expiredTs')

echo "✅ Payment order created!"
echo "Order ID:      $ORDER_ID"
echo "Amount:        $TOTAL_AMOUNT IDR"
echo "Checkout URL:  $CHECKOUT_URL"
echo "QR Payload:    $QR_PAYLOAD"
echo "Expires:       $EXPIRED_TS"
echo ""

# Save for later use
echo "$ORDER_ID" > order_id.txt
echo "$PAYMENT_RESPONSE" | jq '.' > payment_response.json
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "order_1729756800",
    "checkoutUrl": "https://billers.ing1.com/qris/TRX20241024001",
    "qrPayload": "00020126360014...",
    "playerId": "customer_123",
    "totalAmount": 100000,
    "expiredTs": "2024-10-25T16:00:00Z"
  }
}
```

### Step 1b: Customer Pays (Simulated)

```bash
echo "=== Step 2: Customer Scans QR and Pays ==="
echo "Customer opens: $CHECKOUT_URL"
echo "Or scans QR: $QR_PAYLOAD"
echo "Payment processing via INA..."
sleep 3
echo "✅ Payment completed by customer!"
```

### Step 1c: Check Payment Status

```bash
echo "=== Step 3: Check Payment Status ==="

# Option A: Your API (if endpoint exists)
curl -s -X GET "$API_DOMAIN/api/v1/orders/$ORDER_ID" \
  -H "x-api-key: $API_KEY" | jq '.data | {orderId, status, amount, channel}'

# Response should show: status: PAID
```

---

## 🏪 PART 2: WITHDRAWAL FLOW (End-to-End)

### Step 2a: Check Balance First

```bash
#!/bin/bash

PARTNER_TOKEN="your_jwt_token"
API_DOMAIN="https://yourdomain.com"

echo "=== Step 4: Check Partner Balance ==="
BALANCE=$(curl -s -X GET "$API_DOMAIN/api/v1/client/dashboard/balance" \
  -H "Authorization: Bearer $PARTNER_TOKEN")

AVAILABLE_BALANCE=$(echo "$BALANCE" | jq '.balance')
echo "✅ Current balance: Rp $AVAILABLE_BALANCE"
echo ""
```

### Step 2b: Request Withdrawal

```bash
echo "=== Step 5: Request Withdrawal ==="

# Withdrawal parameters
ACCOUNT_NUMBER="1234567890"
BANK_CODE="002"
ACCOUNT_NAME="John Partner"
BANK_NAME="BRI"
WITHDRAWAL_AMOUNT=500000

WITHDRAWAL_RESPONSE=$(curl -s -X POST "$API_DOMAIN/api/v1/client/dashboard/withdraw" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PARTNER_TOKEN" \
  -d '{
    "subMerchantId": "'$SUB_MERCHANT_ID'",
    "sourceProvider": "ing1",
    "account_number": "'$ACCOUNT_NUMBER'",
    "bank_code": "'$BANK_CODE'",
    "account_name": "'$ACCOUNT_NAME'",
    "bank_name": "'$BANK_NAME'",
    "amount": '$WITHDRAWAL_AMOUNT'
  }')

# Extract response
WD_ID=$(echo "$WITHDRAWAL_RESPONSE" | jq -r '.id')
WD_REF=$(echo "$WITHDRAWAL_RESPONSE" | jq -r '.refId')
WD_STATUS=$(echo "$WITHDRAWAL_RESPONSE" | jq -r '.status')

echo "✅ Withdrawal requested!"
echo "Withdrawal ID:  $WD_ID"
echo "Ref ID:         $WD_REF"
echo "Status:         $WD_STATUS"
echo ""

echo "$WD_REF" > withdrawal_ref.txt
echo "$WITHDRAWAL_RESPONSE" | jq '.' > withdrawal_response.json
```

**Response:**
```json
{
  "id": "wr_abc123",
  "refId": "wd-1729756800000",
  "status": "PENDING"
}
```

### Step 2c: What Happens Internally (INA API Calls)

```bash
echo "=== Internal: INA Account Inquiry ==="
echo "Your API calls: POST /transaction/cashout/inquiry"
echo "  bankCode: 002"
echo "  accountNumber: 1234567890"
echo "  amount: 500000"
echo ""
echo "INA Response:"
echo "  reff: REF20241024001"
echo "  accountName: JOHN PARTNER (verified)"
echo "  fee: 6500"
echo "  status: OK"
echo ""

echo "=== Internal: INA Payment Execution ==="
echo "Your API calls: POST /transaction/cashout/payment"
echo "  reff: REF20241024001"
echo "  amount: 500000"
echo ""
echo "INA Response:"
echo "  rc: 0 (success)"
echo "  status: ACCEPTED"
echo "  reff: REF20241024001"
echo ""

echo "=== Internal: Fallback Checker Scheduled ==="
echo "Your API schedules periodic check via cashoutCheck()"
echo "Every 30 seconds:"
echo "  POST /transaction/cashout/check {reff: REF20241024001}"
echo ""
```

### Step 2d: Check Withdrawal Status

```bash
echo "=== Step 6: Check Withdrawal Status ==="
sleep 2

WD_REF=$(cat withdrawal_ref.txt)

WD_STATUS=$(curl -s -X GET "$API_DOMAIN/api/v1/client/dashboard/withdrawals/$WD_REF" \
  -H "Authorization: Bearer $PARTNER_TOKEN")

echo "$WD_STATUS" | jq '{
  refId: .refId,
  status: .status,
  amount: .amount,
  netAmount: .netAmount,
  pgFee: .pgFee,
  bankName: .bankName,
  accountNumber: .accountNumber,
  createdAt: .createdAt
}'

echo ""
echo "Status may be:"
echo "  PENDING    → Waiting for INA completion"
echo "  COMPLETED  → Successfully transferred"
echo "  FAILED     → Transfer failed"
echo ""
```

### Step 2e: Wait for Completion (Optional - Fallback Works)

```bash
echo "=== Step 7: Wait for Completion ==="
echo "Option A: INA sends webhook callback → Status updates to COMPLETED"
echo "Option B: No webhook → Fallback checker runs every 30s → Status updates"
echo ""
echo "Waiting 30 seconds for fallback checker..."
sleep 30

WD_STATUS=$(curl -s -X GET "$API_DOMAIN/api/v1/client/dashboard/withdrawals/$WD_REF" \
  -H "Authorization: Bearer $PARTNER_TOKEN" | jq -r '.status')

echo "✅ Final status: $WD_STATUS"
echo ""

if [ "$WD_STATUS" == "COMPLETED" ]; then
  echo "✅ Money should arrive at bank account shortly!"
else
  echo "⏳ Still processing. Check again soon..."
fi

echo "$WD_STATUS" > withdrawal_status.txt
```

### Step 2f: List All Withdrawals

```bash
echo "=== Alternative: List All Withdrawals ==="

curl -s -X GET "$API_DOMAIN/api/v1/client/dashboard/withdrawals?sourceProvider=ing1&limit=10&status=PENDING" \
  -H "Authorization: Bearer $PARTNER_TOKEN" | jq '.data[] | {
    refId,
    status,
    amount,
    netAmount,
    pgFee,
    bankName,
    createdAt
  }'

echo ""
```

---

## 💼 PART 3: SETTLEMENT FLOW (Automatic at 4 PM)

### Step 3a: Manual Settlement (For Testing)

```bash
#!/bin/bash

ADMIN_TOKEN="your_admin_jwt_token"
API_DOMAIN="https://yourdomain.com"

echo "=== Step 8: Run Manual Settlement (For Testing) ==="
echo "Normally runs automatically at 4 PM daily"
echo "You can trigger manually for testing:"
echo ""

SETTLEMENT=$(curl -s -X POST "$API_DOMAIN/api/v1/admin/settlement/run-manual" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "filters": {
      "dateFrom": "2024-10-20",
      "dateTo": "2024-10-24",
      "paymentMethods": ["ing1"]
    }
  }')

SETTLEMENT_JOB_ID=$(echo "$SETTLEMENT" | jq -r '.jobId')

echo "✅ Settlement job started!"
echo "Job ID: $SETTLEMENT_JOB_ID"
echo ""

echo "$SETTLEMENT" | jq '.'
```

**Response:**
```json
{
  "success": true,
  "jobId": "job_xyz789",
  "status": "running",
  "message": "Settlement job started"
}
```

### Step 3b: Check Settlement Progress

```bash
echo "=== Check Settlement Job Progress ==="

SETTLEMENT_JOB_ID="job_xyz789"

curl -s -X GET "$API_DOMAIN/api/v1/admin/settlement/job/$SETTLEMENT_JOB_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '{
    status,
    settledOrders,
    totalAmount,
    failedCount,
    progress,
    startTime,
    endTime
  }'

echo ""
```

**Response:**
```json
{
  "status": "completed",
  "settledOrders": 145,
  "totalAmount": 14500000,
  "failedCount": 2,
  "progress": "100%",
  "startTime": "2024-10-24T16:00:00Z",
  "endTime": "2024-10-24T16:05:30Z"
}
```

### Step 3c: What Settlement Does (Behind the Scenes)

```bash
echo "=== Settlement Process (Automatic at 4 PM) ==="
echo ""
echo "Step 1: Fetch all PAID orders from database"
echo "  SELECT * FROM orders WHERE status='PAID' AND channel='ing1'"
echo ""

echo "Step 2: For each order, check with INA"
echo "  POST https://api.ing1.com/transaction/cashin/check"
echo "  {reff: order.pgRefId}"
echo ""

echo "Step 3: If INA confirms PAID"
echo "  Update order: status = 'SETTLED'"
echo "  Extract: amount, reff, paid_at"
echo ""

echo "Step 4: Update partner balance"
echo "  UPDATE partnerClient SET balance += amount"
echo "  WHERE id = order.partnerClientId"
echo ""

echo "Step 5: Send Telegram notification"
echo "  'Settled 145 orders, net 14.5M IDR'"
echo ""

echo "✅ Settlement complete!"
echo "   All PAID orders → SETTLED"
echo "   All balances updated"
echo "   Notifications sent"
echo ""
```

### Step 3d: Verify Settlement Results

```bash
echo "=== Step 9: Verify Settlement Results ==="

echo ""
echo "1. Check order status changed to SETTLED:"
ORDER_ID=$(cat order_id.txt)
curl -s -X GET "$API_DOMAIN/api/v1/orders/$ORDER_ID" \
  -H "x-api-key: $API_KEY" | jq '.data | {
    orderId,
    status,
    amount,
    settlementAmount,
    settlementTime,
    channel
  }'

echo ""
echo "2. Check partner balance increased:"
curl -s -X GET "$API_DOMAIN/api/v1/client/dashboard/balance" \
  -H "Authorization: Bearer $PARTNER_TOKEN" | jq '{
    balance,
    pendingSettlement,
    lastSettlementTime
  }'

echo ""
echo "3. View settlement history:"
curl -s -X GET "$API_DOMAIN/api/v1/admin/settlement/history?limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data[] | {
    jobId,
    status,
    settledOrders,
    totalAmount,
    completedAt
  }'

echo ""
```

---

## 🔄 COMPLETE END-TO-END SCRIPT

```bash
#!/bin/bash

set -e

# ==================== CONFIGURATION ====================
API_KEY="your_api_key_here"
PARTNER_TOKEN="your_jwt_token"
ADMIN_TOKEN="your_admin_token"
API_DOMAIN="https://yourdomain.com"
SUB_MERCHANT_ID="sub_ing1_123"
PARTNER_CLIENT_ID="partner_client_123"

# ==================== PART 1: PAYMENT ====================
echo ""
echo "╔════════════════════════════════════════╗"
echo "║  PART 1: PAYMENT FLOW                  ║"
echo "╚════════════════════════════════════════╝"
echo ""

echo "Step 1️⃣ : Create Payment Order"
PAYMENT=$(curl -s -X POST "$API_DOMAIN/api/v1/create-order" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "price": 100000,
    "playerId": "customer_123",
    "buyer": "'$PARTNER_CLIENT_ID'",
    "merchantName": "ing1",
    "subMerchantId": "'$SUB_MERCHANT_ID'",
    "transactionDescription": "Test Payment",
    "customerEmail": "test@example.com",
    "customerFullName": "Test User"
  }')

ORDER_ID=$(echo "$PAYMENT" | jq -r '.data.orderId')
CHECKOUT_URL=$(echo "$PAYMENT" | jq -r '.data.checkoutUrl')
QR=$(echo "$PAYMENT" | jq -r '.data.qrPayload')
AMOUNT=$(echo "$PAYMENT" | jq -r '.data.totalAmount')

echo "✅ Order created: $ORDER_ID"
echo "   Amount: Rp $AMOUNT"
echo "   Checkout: $CHECKOUT_URL"
echo ""

echo "Step 2️⃣ : Simulate Customer Payment"
echo "💳 Customer scanning QR or opening checkout URL..."
sleep 2
echo "✅ Payment completed by customer"
echo ""

echo "Step 3️⃣ : Check Payment Status"
PAYMENT_STATUS=$(curl -s -X GET "$API_DOMAIN/api/v1/orders/$ORDER_ID" \
  -H "x-api-key: $API_KEY" | jq -r '.data.status')

echo "✅ Payment status: $PAYMENT_STATUS (should be PAID)"
echo ""

# ==================== PART 2: WITHDRAWAL ====================
echo ""
echo "╔════════════════════════════════════════╗"
echo "║  PART 2: WITHDRAWAL FLOW               ║"
echo "╚════════════════════════════════════════╝"
echo ""

echo "Step 4️⃣ : Check Balance"
BALANCE=$(curl -s -X GET "$API_DOMAIN/api/v1/client/dashboard/balance" \
  -H "Authorization: Bearer $PARTNER_TOKEN" | jq '.balance')

echo "✅ Available balance: Rp $BALANCE"
echo ""

echo "Step 5️⃣ : Request Withdrawal"
WD=$(curl -s -X POST "$API_DOMAIN/api/v1/client/dashboard/withdraw" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PARTNER_TOKEN" \
  -d '{
    "subMerchantId": "'$SUB_MERCHANT_ID'",
    "sourceProvider": "ing1",
    "account_number": "1234567890",
    "bank_code": "002",
    "account_name": "Test Partner",
    "bank_name": "BRI",
    "amount": 500000
  }')

WD_REF=$(echo "$WD" | jq -r '.refId')
WD_STATUS=$(echo "$WD" | jq -r '.status')

echo "✅ Withdrawal requested: $WD_REF"
echo "   Status: $WD_STATUS"
echo ""

echo "Step 6️⃣ : Wait for Processing (Fallback Checker)"
echo "⏳ Waiting 30 seconds for status update..."
sleep 30

WD_FINAL=$(curl -s -X GET "$API_DOMAIN/api/v1/client/dashboard/withdrawals/$WD_REF" \
  -H "Authorization: Bearer $PARTNER_TOKEN")

WD_FINAL_STATUS=$(echo "$WD_FINAL" | jq -r '.status')
WD_AMOUNT=$(echo "$WD_FINAL" | jq -r '.amount')
WD_FEE=$(echo "$WD_FINAL" | jq -r '.pgFee')

echo "✅ Withdrawal final status: $WD_FINAL_STATUS"
echo "   Amount: Rp $WD_AMOUNT"
echo "   INA Fee: Rp $WD_FEE"
echo ""

# ==================== PART 3: SETTLEMENT ====================
echo ""
echo "╔════════════════════════════════════════╗"
echo "║  PART 3: SETTLEMENT FLOW               ║"
echo "╚════════════════════════════════════════╝"
echo ""

echo "Step 7️⃣ : Run Manual Settlement"
SETTLEMENT=$(curl -s -X POST "$API_DOMAIN/api/v1/admin/settlement/run-manual" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "filters": {
      "dateFrom": "2024-10-20",
      "dateTo": "2024-10-24",
      "paymentMethods": ["ing1"]
    }
  }')

SETTLEMENT_ID=$(echo "$SETTLEMENT" | jq -r '.jobId')
echo "✅ Settlement job started: $SETTLEMENT_ID"
echo ""

echo "Step 8️⃣ : Wait for Settlement to Complete"
sleep 3
SETTLEMENT_STATUS=$(curl -s -X GET "$API_DOMAIN/api/v1/admin/settlement/job/$SETTLEMENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.status')

echo "✅ Settlement status: $SETTLEMENT_STATUS"
echo ""

echo "Step 9️⃣ : Verify Results"
echo ""
echo "Order status (should be SETTLED):"
curl -s -X GET "$API_DOMAIN/api/v1/orders/$ORDER_ID" \
  -H "x-api-key: $API_KEY" | jq '.data | {orderId, status, settlementAmount, settlementTime}'

echo ""
echo "Partner balance (should be increased):"
curl -s -X GET "$API_DOMAIN/api/v1/client/dashboard/balance" \
  -H "Authorization: Bearer $PARTNER_TOKEN" | jq '{balance, lastSettlementTime}'

echo ""
echo "╔════════════════════════════════════════╗"
echo "║  ✅ END-TO-END FLOW COMPLETE!          ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "Summary:"
echo "  1️⃣  Payment: Order $ORDER_ID created and paid"
echo "  2️⃣  Withdrawal: $WD_AMOUNT transferred (Status: $WD_FINAL_STATUS)"
echo "  3️⃣  Settlement: Job $SETTLEMENT_ID completed"
echo ""
echo "Next: Check Telegram for settlement notification 🔔"
echo ""
```

---

## 📊 Complete Flow Diagram

```
═══════════════════════════════════════════════════════════════════════════════

                           🚀 INA END-TO-END FLOW

═══════════════════════════════════════════════════════════════════════════════

CUSTOMER PAYS (Payment Flow)
────────────────────────────

1. Partner creates order
   curl POST /api/v1/create-order
   → {orderId, checkoutUrl, qrPayload}
        ↓
2. Customer scans QR or opens URL
   → INA payment page
        ↓
3. Customer completes payment
   → INA processes (QRIS, Bank Transfer, E-wallet)
        ↓
4. Payment callback (or fallback check)
   → Order status: PAID
        ↓
5. Settlement next day at 4 PM
   → Order status: SETTLED
   → Partner balance updated


PARTNER WITHDRAWS (Withdrawal Flow)
──────────────────────────────────

6. Partner requests withdrawal
   curl POST /api/v1/client/dashboard/withdraw
   → {refId, status: PENDING}
        ↓
7. Your API validates account
   → INA cashoutInquiry()
   → Returns: account verified, fee
        ↓
8. Your API executes payment
   → INA cashoutPayment()
   → Returns: ACCEPTED
        ↓
9. Fallback checker runs every 30s
   → INA cashoutCheck()
   → Status updates to COMPLETED when done
        ↓
10. Money arrives at bank account
    → Withdrawal status: COMPLETED


SYSTEM SETTLES (Settlement Flow)
────────────────────────────────

11. Daily at 4 PM
    → Cron job starts settlement
        ↓
12. For each PAID order
    → Call INA to check status
    → If confirmed PAID, mark SETTLED
        ↓
13. Update partner balances
    → balance += settlementAmount
        ↓
14. Send Telegram notification
    → "Settled X orders, net Y amount"
        ↓
15. Ready for next cycle


═══════════════════════════════════════════════════════════════════════════════
```

---

## ✅ Verification Checklist

After running the end-to-end flow:

- [ ] Payment order created with ID
- [ ] QR code and checkout URL generated
- [ ] Payment status shows PAID
- [ ] Withdrawal request successful
- [ ] Withdrawal status PENDING initially
- [ ] Withdrawal status updates to COMPLETED
- [ ] Settlement job completed
- [ ] Order status changed to SETTLED
- [ ] Partner balance increased
- [ ] Telegram notification received

---

## 🆘 Troubleshooting

### Issue: Payment not paid
**Solution:** Wait a moment, payment is processing. Fallback checker will update it.

### Issue: Withdrawal inquiry fails
**Solution:** Verify bank account number and code are correct

### Issue: Settlement didn't run
**Solution:** Check if it's 4 PM, or use manual endpoint for testing

### Issue: Balance not updated
**Solution:** Wait for settlement to complete (check job status)

---

## 📝 Notes

- **Payment:** Automatic via callback or fallback checker
- **Withdrawal:** Your API makes 2 calls (inquiry + payment) + fallback
- **Settlement:** Automatic daily at 4 PM, or use manual endpoint for testing
- **All async:** Don't wait in your code, use webhooks or status checking
- **Atomic:** All database transactions are atomic

---

## 🎉 Summary

**You now have:**
- ✅ Complete payment flow (curl)
- ✅ Complete withdrawal flow (curl)
- ✅ Complete settlement flow (curl)
- ✅ Full end-to-end test script
- ✅ Verification checklist

**Ready to test!** 🚀
