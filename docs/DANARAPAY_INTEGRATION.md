# DanaRpay VA Aggregator Integration - Launcx

## Files Changed/Created

### New Files
1. `src/service/danarapayClient.ts` - HTTP client untuk DanaRpay API
2. `src/controller/danarapayVa.controller.ts` - Controller untuk create VA, callback handler, status inquiry
3. `src/route/danarapay.callback.routes.ts` - Express routes dengan Swagger docs

### Modified Files
1. `src/config.ts` - Tambah config `danarapay` 
2. `src/app.ts` - Register routes + rate limit exemption untuk callback

## API Endpoints

### Public (Callback dari DanaRpay)
```
POST /api/v1/payments/danarapay/va/callback
```

### Protected (API Key Auth)
```
POST /api/v1/payments/danarapay/va/create    - Buat VA baru
GET  /api/v1/payments/danarapay/va/status/:partnerTrxId - Cek status VA
GET  /api/v1/payments/danarapay/va/banks     - List bank tersedia
```

## Environment Variables (wajib)

```bash
DANARAPAY_BASE_URL=https://api-sandbox.danarapay.com
DANARAPAY_MERCHANT_ID=xxx
DANARAPAY_API_KEY=xxx
DANARAPAY_SECRET_KEY=xxx
DANARAPAY_CALLBACK_URL=https://<domain>/api/v1/payments/danarapay/va/callback
```

## Testing

### 1. Create VA
```bash
curl -X POST https://<domain>/api/v1/payments/danarapay/va/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <your-launcx-api-key>" \
  -d '{
    "bankCode": "BCA",
    "customerName": "John Doe",
    "amount": 100000,
    "expirationMinutes": 1440
  }'
```

### 2. Check Status
```bash
curl -X GET https://<domain>/api/v1/payments/danarapay/va/status/<partnerTrxId> \
  -H "X-API-Key: <your-launcx-api-key>"
```

### 3. Simulate Callback (for testing)
```bash
curl -X POST https://<domain>/api/v1/payments/danarapay/va/callback \
  -H "Content-Type: application/json" \
  -d '{
    "trx_id": "DRP123456",
    "partner_trx_id": "<partnerTrxId>",
    "va_number": "1234567890123456",
    "bank_code": "BCA",
    "amount": 100000,
    "paid_amount": 100000,
    "status": "PAID",
    "paid_at": "2024-01-15T10:30:00Z"
  }'
```

## Idempotency

Callback handler menggunakan idempotent update:
- Mencegah duplikat update dari callback yang sama
- Mencegah backward transition (SUCCESS → PENDING tidak akan terjadi)
- Menyimpan raw callback di `transaction_callback` untuk audit

## ASSUMPTIONS

Karena dokumentasi DanaRpay tidak accessible saat development:

1. **API Structure**: Mengikuti pola standar VA aggregator Indonesia (mirip OY!, Xendit)
2. **Signature**: HMAC-SHA256 dengan format `merchantId + timestamp + body`
3. **Endpoints**: 
   - Create VA: `POST /api/v1/va/create`
   - Status: `POST /api/v1/va/status`
   - Banks: `GET /api/v1/va/banks`
4. **Callback Payload**: JSON dengan field standar (trx_id, partner_trx_id, status, etc.)

**Jika struktur API berbeda**, adjust field mapping di `danarapayClient.ts` sesuai dokumentasi aktual.

## Next Steps

1. Verifikasi endpoint URL dan payload structure dengan docs DanaRpay
2. Set environment variables dengan credentials asli
3. Test di sandbox environment
4. Register callback URL di DanaRpay Dashboard
