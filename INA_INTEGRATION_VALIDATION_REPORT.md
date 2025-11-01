# INA Integration Validation Report vs Postman Collection

## Summary
Found **3 CRITICAL ISSUES** in URL construction and configuration

---

## 🔴 ISSUE #1: Settlement Cron - Incorrect URL Pattern

**File**: `src/cron/settlement.ts:188`

**Current Implementation**:
```typescript
const baseUrl = inaCreds.baseUrl || 'https://core.inacash.co.id'
const checkResp = await axios.post(
  `${baseUrl}/api/v2/transaction/cashin/check`,
  // ...
)
```

**Result**: `https://core.inacash.co.id/api/v2/transaction/cashin/check`

**Postman Collection Pattern**:
```
{{BASE_URL}}/{{VERSION}}/transaction/cashin/check
```

**If using https://core-dev.inacash.co.id/api**:
- BASE_URL should be: `https://core-dev.inacash.co.id/api`
- VERSION should be: `v2` or `v1`
- URL should be: `https://core-dev.inacash.co.id/api/v2/transaction/cashin/check`

**Problem**: Current code hardcodes `/api/v2` which assumes baseUrl does NOT include `/api`
- ✗ If baseUrl = `https://core-dev.inacash.co.id/api`, result becomes:
  - `https://core-dev.inacash.co.id/api/api/v2/...` (WRONG - double `/api`)
- ✓ If baseUrl = `https://core-dev.inacash.co.id`, result becomes:
  - `https://core-dev.inacash.co.id/api/v2/...` (CORRECT)

---

## 🔴 ISSUE #2: Payment Creation (Ing1Client) - Different URL Pattern

**File**: `src/service/ing1Client.ts:264-269`

**Current Implementation**:
```typescript
const trimmedBase = cfg.baseUrl.replace(/\/$/, '');
const version = cfg.apiVersion ? cfg.apiVersion.replace(/^\//, '') : '';
const baseURL = version ? `${trimmedBase}/${version}` : trimmedBase;
// Result: https://api.ing1.com/v2
```

**Then in createCashin (line 395)**:
```typescript
url: 'transaction/cashin/create',
// Full URL: https://api.ing1.com/v2/transaction/cashin/create
```

**Problem**: Uses relative path without `/api` prefix
- Expects baseUrl to NOT include `/api`
- If baseUrl = `https://api.ing1.com` and apiVersion = `v2`
- Result: `https://api.ing1.com/v2/transaction/cashin/create` (WRONG - missing `/api`)

**Should be**: `https://api.ing1.com/api/v2/transaction/cashin/create`

---

## 🔴 ISSUE #3: Inconsistent Base URL Across Services

**Current Configuration Issues**:

| Service | File | Default BaseURL | Pattern | Postman Compatible? |
|---------|------|-----------------|---------|-------------------|
| Payment Creation | `ing1Client.ts:395` | `https://api.ing1.com` | `${baseUrl}/${version}/transaction/cashin/create` | ❌ NO |
| Settlement Check | `settlement.ts:188` | `https://core.inacash.co.id` | `${baseUrl}/api/v2/transaction/cashin/check` | ❌ NO |
| Bank Codes | `inacashSettlement.service.ts:147` | `https://api.ing1.com` | via Ing1Client | ❌ NO |
| Inquiry | `inacashSettlement.service.ts:191` | `https://api.ing1.com` | via Ing1Client | ❌ NO |

**Postman Collection Expectation**:
```
{{BASE_URL}}/{{VERSION}}/transaction/cashin/create
= https://core-dev.inacash.co.id/api/v2/transaction/cashin/create
```

This requires:
- baseUrl = `https://core-dev.inacash.co.id/api`
- version/apiVersion = `v2`

---

## ✅ SOLUTION

### Step 1: Standardize BaseURL across all services

**Update database sub_merchant credentials**:
```json
{
  "baseUrl": "https://core-dev.inacash.co.id/api",
  "apiVersion": "v2",
  "email": "...",
  "password": "...",
  "productCode": "QRIS_DIRECT",
  "merchantId": "..."
}
```

### Step 2: Update Ing1Client URL construction

**File**: `src/service/ing1Client.ts:265-272`

Change from:
```typescript
const baseURL = version ? `${trimmedBase}/${version}` : trimmedBase;
```

To:
```typescript
// BaseURL already includes /api (e.g., https://core-dev.inacash.co.id/api)
// Just append version if provided
const baseURL = version ? `${trimmedBase}/${version}` : trimmedBase;
// Result: https://core-dev.inacash.co.id/api/v2
```

✓ This will work correctly because baseUrl already includes `/api`

### Step 3: Update settlement.ts URL construction

**File**: `src/cron/settlement.ts:188`

Change from:
```typescript
`${baseUrl}/api/v2/transaction/cashin/check`
```

To:
```typescript
const version = inaCreds.apiVersion || 'v2'
`${baseUrl}/${version}/transaction/cashin/check`
```

This assumes baseUrl already includes `/api`.

### Step 4: Update default baseUrl values

**File**: `src/service/inacashSettlement.service.ts` - Lines 37, 98, 146, 178

Change all from:
```typescript
baseUrl: raw.baseUrl || 'https://api.ing1.com',
```

To:
```typescript
baseUrl: raw.baseUrl || 'https://core-dev.inacash.co.id/api',
```

### Step 5: Set correct apiVersion

**File**: `src/service/ing1Client.ts:266`

Ensure apiVersion defaults to 'v2':
```typescript
const version = cfg.apiVersion ? cfg.apiVersion.replace(/^\//, '') : 'v2';
```

---

## 📋 Validation Checklist

### Postman Collection Endpoints
- ✓ `{{BASE_URL}}/{{VERSION}}/transaction/cashin/create` (POST) - Payment Create
- ✓ `{{BASE_URL}}/{{VERSION}}/transaction/cashin/check` (POST) - Check Status
- ✓ `{{BASE_URL}}/{{VERSION}}/transaction/cashin/history` (GET) - History
- ✓ `{{BASE_URL}}/{{VERSION}}/transaction/cashout/inquiry` (POST) - Inquiry
- ✓ `{{BASE_URL}}/{{VERSION}}/transaction/cashout/payment` (POST) - Payment
- ✓ `{{BASE_URL}}/{{VERSION}}/user/login` (POST) - Login

### With Correct Configuration

If using:
- BASE_URL = `https://core-dev.inacash.co.id/api`
- VERSION = `v2`

Then all endpoints become:
- `https://core-dev.inacash.co.id/api/v2/transaction/cashin/create` ✓
- `https://core-dev.inacash.co.id/api/v2/transaction/cashin/check` ✓
- `https://core-dev.inacash.co.id/api/v2/transaction/cashin/history` ✓
- `https://core-dev.inacash.co.id/api/v2/transaction/cashout/inquiry` ✓
- `https://core-dev.inacash.co.id/api/v2/transaction/cashout/payment` ✓
- `https://core-dev.inacash.co.id/api/v2/user/login` ✓

---

## 🔍 Request/Response Validation

### createCashin Request
**Postman**: 
```json
{
  "product_code": "QRIS_DIRECT",
  "amount": 10000,
  "client_reff": "unique-id",
  "remark": "optional",
  "expiry_time": "60",
  "return_url": "https://...",
  "merchant_id": "optional"
}
```

**Implementation** (`ing1Client.ts:378-391`): ✓ CORRECT

### createCashin Response
**Postman**:
```json
{
  "rc": 0,
  "message": "successfully create cash-in transaction",
  "data": {
    "amount": 10000,
    "payment_url": null,
    "content": "QR_CODE_STRING",
    "return_url": "https://google.com",
    "status": "pending",
    "expired_at": "2025-06-03 21:27:55"
  },
  "reff": "1748960275QG1HNug",
  "client_reff": "test-7-2",
  "product_code": "QRIS_DIRECT"
}
```

**Implementation** (`ing1Client.ts:399-412`): ✓ CORRECT

### checkCashin Request
**Postman**:
```json
{
  "reff": "1748960275QG1HNug",
  "client_reff": "test-7-2"
}
```

**Implementation** (`ing1Client.ts:417-424`): ✓ CORRECT

### Settlement Check (cron) Request
**Current** (`settlement.ts:189-195`):
```json
{
  "product_code": "QRIS_DIRECT",
  "custno": "merchant_id",
  "reff": "order_id",
  "email": "...",
  "password": "..."
}
```

**Postman Says**: Only `reff` and `client_reff` are optional parameters for check endpoint
- ✗ Should NOT send `product_code`, `custno`, `email`, `password`
- This appears to be a custom endpoint not in Postman collection

---

## 🎯 Key Recommendations

1. ✅ **Use correct base URL**: `https://core-dev.inacash.co.id/api`
2. ✅ **Use API version v2**: Not v1
3. ✅ **Standardize across all services**: Use same baseUrl + apiVersion pattern
4. ⚠️ **Settlement check endpoint**: Verify if custom API or different service
5. ✅ **Payment creation**: Currently correct, just needs URL fix
6. ✅ **Authentication**: Token-based, correctly implemented

