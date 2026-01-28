# DanaRpay VA Aggregator Integration - Launcx

Based on official API docs v1.2.4: https://api-docs.danarapay.com/#tag/VA-Aggregator

## Files Changed/Created

### New Files
1. `src/service/danarapayClient.ts` - HTTP client untuk DanaRpay API
2. `src/controller/danarapayVa.controller.ts` - Controller untuk VA endpoints + callback handler
3. `src/route/danarapay.callback.routes.ts` - Express routes dengan Swagger docs

### Modified Files
1. `src/config.ts` - Tambah config `danarapay` 
2. `src/app.ts` - Register routes + rate limit exemption untuk callback

## Environment Variables

```bash
# DanaRpay Base URL
# Production: https://partner.danarapay.com
# Staging: https://api-stg.danarapay.com
DANARAPAY_BASE_URL=https://api-stg.danarapay.com

# Credentials dari DanaRpay Dashboard
DANARAPAY_USERNAME=your_username
DANARAPAY_API_KEY=your_api_key
```

## Supported Banks

| Bank Code | Bank Name | Open Amount | Closed Amount | Lifetime |
|-----------|-----------|-------------|---------------|----------|
| 002 | BRI | ✓ | ✓ | ✓ |
| 008 | Mandiri | ✓ | ✓ | ✓ |
| 009 | BNI | ✗ | ✓ | ✓ |
| 013 | Permata | ✓ | ✓ | ✓ |
| 022 | CIMB | ✓ | ✓ | ✓ |

## API Endpoints

### Public (Callback dari DanaRpay)
```
POST /api/v1/payments/danarapay/va/callback
```

### Protected (API Key Auth)
```
POST /api/v1/payments/danarapay/va/create         - Buat VA baru
GET  /api/v1/payments/danarapay/va/info/:vaId     - Get VA info
PUT  /api/v1/payments/danarapay/va/update/:vaId   - Update VA
POST /api/v1/payments/danarapay/va/simulate-callback - Simulate payment (staging)
GET  /api/v1/payments/danarapay/va/banks          - List bank tersedia
```

## VA Status Flow

```
WAITING_PAYMENT → PAYMENT_DETECTED → COMPLETE (if single_use=true)
                                   → WAITING_PAYMENT (if single_use=false)
              
WAITING_PAYMENT → EXPIRED (after expiration_time)
              → STATIC_TRX_EXPIRED (transaction expired, VA still active if lifetime)
```

## Testing

### 1. Create VA (Closed Amount, Single Use)
```bash
curl -X POST https://<domain>/api/v1/payments/danarapay/va/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <launcx-api-key>" \
  -d '{
    "partner_user_id": "user-123",
    "bank_code": "002",
    "amount": 20000,
    "is_open": false,
    "is_single_use": true,
    "expiration_time": 30,
    "username_display": "John Doe",
    "partner_trx_id": "TRX-001"
  }'
```

### 2. Get VA Info
```bash
curl -X GET https://<domain>/api/v1/payments/danarapay/va/info/<vaId> \
  -H "X-API-Key: <launcx-api-key>"
```

### 3. Update VA
```bash
curl -X PUT https://<domain>/api/v1/payments/danarapay/va/update/<vaId> \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <launcx-api-key>" \
  -d '{
    "amount": 25000,
    "expiration_time": 60
  }'
```

### 4. Simulate Payment (Staging Only)
```bash
curl -X POST https://<domain>/api/v1/payments/danarapay/va/simulate-callback \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <launcx-api-key>" \
  -d '{
    "id": "<vaId>",
    "amount": 20000
  }'
```

## Callback Payload Structure

DanaRpay akan mengirim callback ke endpoint yang di-set di dashboard saat:
1. User berhasil bayar (settlement_status: WAITING)
2. Settlement selesai (settlement_status: SUCCESS)

```json
{
  "va_number": "910306000000000028",
  "amount": 20000,
  "partner_user_id": "user-123",
  "success": "true",
  "tx_date": "2025-07-01 20:12:30",
  "username_display": "John Doe",
  "trx_expiration_date": "2025-07-01 20:15:00",
  "partner_trx_id": "TRX-001",
  "trx_id": "2da3c897-fc31-4bd9-b729-7a7a2ead29d8",
  "settlement_time": "2025-07-02 15:00:00",
  "settlement_status": "SUCCESS",
  "full_name": "John Doe"
}
```

## Response Codes

| Code | Description |
|------|-------------|
| 000 | Success |
| 203 | Duplicate partner_trx_id |
| 207 | IP address not registered |
| 208 | API key not valid |
| 211 | Bank code not available |
| 212 | Amount less than minimum |
| 213 | Amount greater than maximum |
| 214 | Failed to generate VA |
| 215 | Amount type not supported for bank |
| 216 | VA ID is empty |
| 217 | VA number still active for this user |
| 219 | VA not enabled for this bank |
| 226 | Transaction expiry exceeds VA expiry |
| 246 | Failed to update VA |
| 999 | Internal Server Error |

## Idempotency

Callback handler menggunakan idempotent update:
- Mencegah duplikat update dari callback yang sama
- Mencegah backward transition (SUCCESS → PENDING tidak akan terjadi)
- Menyimpan raw callback di `transaction_callback` untuk audit

## Setup di DanaRpay Dashboard

1. Login ke DanaRpay Business Dashboard
2. Buka **Settings** → **Developer Option** → **Callback Configuration**
3. Set callback URL: `https://<your-domain>/api/v1/payments/danarapay/va/callback`
4. Whitelist IP server Launcx
