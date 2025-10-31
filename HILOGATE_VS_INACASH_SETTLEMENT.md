# Hilogate vs Inacash Settlement - Side-by-Side Comparison

## 🎯 The Core Truth

**Inacash uses the EXACT SAME cron job system as Hilogate.** They both run in the same `processBatch()` function with identical batch processing, concurrency, and database logic.

---

## 📊 Cron Job Execution (Identical)

### Hilogate Flow
```
⏰ Scheduled time → runSettlementJob()
   ↓
📦 Fetch PAID/LN_SETTLED orders (1500 per batch)
   ↓
🔀 For each order with channel='hilogate':
   - Call Hilogate API (GET /api/v1/transactions/{id})
   - Check settlement_status in [ACTIVE, SETTLED, COMPLETED]
   - Extract: net_amount, rrn, updated_at
   ↓
💾 DB transaction: Update order + increment balance
   ↓
📱 Telegram notification
```

### Inacash Flow
```
⏰ Scheduled time → runSettlementJob()
   ↓
📦 Fetch PAID/LN_SETTLED orders (1500 per batch)
   ↓
🔀 For each order with channel='ing1' or 'inacash':
   - Call INA API (POST transaction/cashin/check)
   - Check rc=0 and status='PAID'
   - Extract: amount, reff, paid_at
   ↓
💾 DB transaction: Update order + increment balance
   ↓
📱 Telegram notification
```

---

## 🔌 API Call Comparison

### Hilogate API Call (Lines 127-140)
```typescript
if (o.channel === 'hilogate') {
  const path = `/api/v1/transactions/${o.id}`
  const url = `${config.api.hilogate.baseUrl}${path}`
  const sig = generateSignature(path, secretKey)  // MD5 hash

  const resp = await axios.get(url, {
    headers: {
      'X-Merchant-ID': merchantId,
      'X-Signature': sig
    },
    timeout: 15_000
  })

  const tx = resp.data.data
  const st = (tx.settlement_status || '').toUpperCase()
  if (!['ACTIVE', 'SETTLED', 'COMPLETED'].includes(st)) return

  settlementResult = {
    netAmt: o.pendingAmount ?? tx.net_amount,
    rrn: tx.rrn || 'N/A',
    st,
    tmt: tx.updated_at ? new Date(tx.updated_at) : undefined
  }
}
```

### Inacash API Call (Lines 167-179)
```typescript
else if (o.channel === 'ing1' || o.channel === 'inacash') {
  // Inacash/ING1 settlement check
  const result = await getInacashSettlementResult(o.id, o.subMerchantId || '', creds)
  if (!result) return  // Not ready for settlement

  settlementResult = {
    netAmt: result.netAmt,
    rrn: result.rrn,
    st: result.st,
    tmt: result.tmt,
    fee: result.fee
  }
}
```

### Key Difference
- **Hilogate**: Direct HTTP GET call in cron job
- **Inacash**: Delegated to service function (cleaner, reusable)

Both produce **identical `settlementResult` structure** → Same DB update logic!

---

## 📋 Settlement Result Structure (IDENTICAL)

```typescript
type SettlementResult = {
  netAmt: number      // Settlement amount
  rrn: string         // Reference number
  st: string          // Settlement status
  tmt?: Date          // Settlement time
  fee?: number        // Optional: withdrawal fee
}
```

Both Hilogate and Inacash map their API responses to this same structure:

```typescript
// Hilogate response
{
  net_amount: 100000,
  rrn: "REF123",
  settlement_status: "COMPLETED",
  updated_at: "2024-10-24T16:00:00Z"
}
↓ Maps to ↓
{
  netAmt: 100000,
  rrn: "REF123",
  st: "COMPLETED",
  tmt: Date(2024-10-24T16:00:00Z)
}

// Inacash response
{
  data: {
    amount: 100000,
    paid_at: "2024-10-24T16:00:00Z"
  },
  reff: "TRX123"
}
↓ Maps to ↓
{
  netAmt: 100000,
  rrn: "TRX123",
  st: "COMPLETED",
  tmt: Date(2024-10-24T16:00:00Z)
}
```

---

## 🔄 Database Update (IDENTICAL)

Both Hilogate and Inacash use **the exact same database transaction**:

```typescript
// Lines 195-217 in settlement.ts
const upd = await tx.order.updateMany({
  where: { id: order.id, status: { in: INPUT_SETTLEMENT_STATUSES } },
  data: {
    status: 'SETTLED',
    settlementAmount: settlement.netAmt,    // From either provider
    pendingAmount: null,
    ...(settlement.fee && { fee3rdParty: settlement.fee }),
    rrn: settlement.rrn,                    // From either provider
    settlementStatus: settlement.st,        // From either provider
    settlementTime: settlement.tmt,         // From either provider
    updatedAt: new Date()
  }
})

// Increment partner client balance (both providers)
if (na > 0) {
  await tx.partnerClient.update({
    where: { id: pcId },
    data: { balance: { increment: na } }
  })
}
```

**No difference!** Same update logic for both.

---

## 📊 Batch Processing (IDENTICAL)

```typescript
const BATCH_SIZE = 1500                    // Same for both
const HTTP_CONCURRENCY = Math.max(10, os.cpus().length * 2)
const DB_CONCURRENCY = os.cpus().length
const PARTNER_TX_CHUNK_SIZE = 50           // Same for both
```

Both providers:
- ✅ Process 1500 orders per batch
- ✅ Make HTTP_CONCURRENCY parallel API calls
- ✅ Execute DB_CONCURRENCY parallel transactions
- ✅ Chunk updates by 50 per partner client
- ✅ Retry on deadlock/timeout
- ✅ Send Telegram notifications

---

## 🔑 Configuration Comparison

| Aspect | Hilogate | Inacash |
|--------|----------|---------|
| **Where stored** | `subMerchant.credentials` | `subMerchant.credentials` |
| **Auth type** | Signature-based (MD5) | Token-based (JWT) |
| **Required fields** | `merchantId`, `secretKey` | `email`, `password`, `baseUrl` |
| **API timeout** | 15 seconds | 15 seconds |
| **Retry logic** | Built-in (signature included) | Built-in (token auto-refresh) |

---

## 🚀 Execution Timeline (IDENTICAL)

### Both Follow Same Pattern:

```
1️⃣  Start: Set cutoff time
    cutoffTime = new Date()

2️⃣  Fetch orders: Get all PAID/LN_SETTLED
    created before cutoffTime

3️⃣  Loop batches: While hasMore
    cursor.createdAt, cursor.id

4️⃣  Parallel HTTP: Call all APIs concurrently
    httpLimit(HTTP_CONCURRENCY)

5️⃣  Group results: By partnerClientId
    Map<partnerClientId, SettlementResult[]>

6️⃣  DB transaction: Update & increment balance
    dbLimit(DB_CONCURRENCY)

7️⃣  Next batch: If hasMore, repeat from step 2

8️⃣  Finish: Send Telegram summary
    iterations, settled count, net amount
```

---

## 📱 Monitoring (IDENTICAL)

Both providers send **identical Telegram notifications**:

```
START:
[SettlementCron] Starting settlement check at 2024-10-24T16:00:00Z

MID-PROCESS (every iteration):
[SettlementCron] Iter 1: settled 145 orders
[SettlementCron] Iter 2: settled 156 orders
[SettlementCron] Iter 3: settled 89 orders

COMPLETION:
[SettlementCron] Summary: iterations 3, settled 390 orders, net amount 5,670,000

ERROR:
[SettlementCron] Fatal error: Connection timeout
```

---

## 🔐 Error Handling (IDENTICAL)

Both providers:
- ✅ Retry DB transactions on deadlock (5 attempts, exponential backoff)
- ✅ Skip individual orders on API failure (log error, continue)
- ✅ Skip partner batch on DB failure (log error, continue)
- ✅ Timeout after 15 seconds per API call
- ✅ Timeout after 15 seconds per DB transaction
- ✅ Send Telegram alerts on fatal errors

---

## 📈 Performance (IDENTICAL)

Both providers process orders at the same speed:

```
Example run with 3000 orders:
- Batch 1: 1500 orders → 2 min (parallel HTTP + DB)
- Batch 2: 1500 orders → 2 min
Total: 4 minutes for 3000 orders

All providers (Hilogate, OY, Inacash) use same:
- HTTP concurrency: 20 (10 base + CPU*2)
- DB concurrency: 4-8 (based on CPU count)
- Same batch logic, same performance
```

---

## ✅ Why They're Identical

1. **Same cron scheduler**: Both use `node-cron` with same schedule
2. **Same batch processor**: Both call same `processBatch()` function
3. **Same result structure**: Both map to `SettlementResult` type
4. **Same DB transaction**: Both use identical update/increment logic
5. **Same error handling**: Both retry, skip, and alert identically
6. **Same monitoring**: Both send same Telegram notifications

---

## 🎯 The Only Difference

**API call implementation:**

```
Hilogate:
├─ Direct in cron job (lines 127-140)
├─ Uses crypto to sign request
├─ Parses response.data.data
└─ Checks settlement_status field

Inacash:
├─ Delegated to service (getInacashSettlementResult)
├─ Uses Ing1Client for auth/token
├─ Parses response.data
└─ Checks rc=0 field
```

But both produce same `SettlementResult` → **rest is identical!**

---

## 📝 Code Location

```
src/cron/settlement.ts
├─ Lines 1-13: Imports (added: getInacashSettlementResult)
├─ Lines 15-20: Config (SAME for all providers)
├─ Lines 79-244: processBatch() function
│  ├─ Lines 127-140: Hilogate logic
│  ├─ Lines 141-166: OY Indonesia logic
│  ├─ Lines 167-179: ✨ NEW Inacash logic
│  └─ Lines 181-229: DB update logic (SAME for all)
├─ Lines 259-344: runSettlementJob()
└─ Lines 353-418: Scheduler & manual run (SAME)

src/service/inacashSettlement.service.ts (NEW)
├─ getInacashSettlementResult(): Calls INA API
├─ syncWithInacash(): One-time sync
├─ fetchBankCodes(): Bank codes
└─ inquiryAccount(): Account validation
```

---

## 🎓 Summary

| Feature | Hilogate | Inacash | Status |
|---------|----------|---------|--------|
| Cron scheduler | ✅ node-cron | ✅ node-cron | **IDENTICAL** |
| Cron schedule | ✅ 0 16 * * * | ✅ 0 16 * * * | **IDENTICAL** |
| Batch size | ✅ 1500 | ✅ 1500 | **IDENTICAL** |
| HTTP concurrency | ✅ CPU*2+10 | ✅ CPU*2+10 | **IDENTICAL** |
| DB concurrency | ✅ CPU count | ✅ CPU count | **IDENTICAL** |
| DB update logic | ✅ Same | ✅ Same | **IDENTICAL** |
| Balance increment | ✅ Same | ✅ Same | **IDENTICAL** |
| Error retry | ✅ 5x backoff | ✅ 5x backoff | **IDENTICAL** |
| Notifications | ✅ Telegram | ✅ Telegram | **IDENTICAL** |
| Manual run | ✅ API | ✅ API | **IDENTICAL** |
| Settlement status | ✅ In DB | ✅ In DB | **IDENTICAL** |

✅ **Inacash settlement is 100% integrated with Hilogate in the same cron job system!**
