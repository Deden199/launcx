# PRD - Launcx Payment Gateway (Production Ready)

## Production Deployment
- **Frontend URL:** `https://s2.launcx.com`
- **API Base:** `https://s2.launcx.com/api/v1`

## VA Callback Flow

### 1. Setup di DanaRapay Dashboard
Set callback URL di dashboard DanaRapay ke:
```
https://s2.launcx.com/api/v1/payments/danarapay/va/callback
```

### 2. Callback Flow
```
Customer pays VA → DanaRapay → Launcx callback endpoint → 
Update Order status → Forward callback to Partner Client
```

### 3. Partner Client Setup
Partner perlu register callback URL di Launcx Client Dashboard:
- Login ke `https://s2.launcx.com/client/login`
- Go to **Callback Settings**
- Set callback URL & secret
- Launcx akan POST ke URL tersebut dengan payload:

```json
{
  "orderId": "19cc351e-cd81-4300-af19-ecac8e3a3144",
  "status": "SUCCESS",
  "channel": "VA",
  "vaNumber": "8618830003000000039",
  "bankCode": "008",
  "bankName": "Mandiri",
  "grossAmount": 50000,
  "feeLauncx": 500,
  "netAmount": 49500,
  "playerId": "user_123",
  "settlementStatus": "SUCCESS",
  "timestamp": "2025-01-30T14:30:00Z",
  "nonce": "uuid-v4"
}
```

Header: `X-Callback-Signature: <HMAC-SHA256 signature>`

## Files Changed Today

### Backend
- `src/controller/danarapayVa.controller.ts`
  - Added `crypto` import
  - **Create VA** now saves Order record with `channel: 'VA_DANARAPAY'`
  - **Callback handler** now forwards to partner client via `callbackJob` queue
  
- `src/controller/clientDashboard.controller.ts`
  - Added `getVaDashboard` endpoint
  - Added `getActiveVaList` endpoint

- `src/route/client/web.routes.ts`
  - Added `/va-dashboard` route
  - Added `/va-active` route

### Frontend
- `src/pages/client/dashboard.tsx` - QRIS only, with link to VA Dashboard
- `src/pages/client/va-dashboard.tsx` - New dedicated VA dashboard
- `src/pages/docs.tsx` - Updated API documentation

## API Endpoints Summary

### Payment Creation
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/payments` | POST | Create QRIS payment |
| `/payments/danarapay/va/create` | POST | Create VA |
| `/payments/danarapay/va/info/{id}` | GET | Get VA info |
| `/payments/danarapay/va/update/{id}` | PUT | Update VA |

### Callback
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/payments/danarapay/va/callback` | POST | DanaRapay webhook endpoint |
| `/client/callbacks/{id}/retry` | POST | Retry failed callback |

### Client Dashboard
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/client/dashboard` | GET | QRIS transactions |
| `/client/va-dashboard` | GET | VA transactions + stats |
| `/client/va-active` | GET | Active VA list |
| `/client/callback-url` | GET/POST | Manage callback URL |

## Deployment Checklist
- [x] Backend compiled
- [x] Frontend built
- [x] VA callback forwarding implemented
- [x] API docs updated
- [x] Branding cleaned
- [ ] Deploy to s2.launcx.com
- [ ] Set DanaRapay callback URL
- [ ] Test end-to-end flow

## Environment Variables
```bash
# Frontend
NEXT_PUBLIC_API_URL=https://s2.launcx.com/api/v1

# Backend
DATABASE_URL=mongodb://...
JWT_SECRET=...
DANARAPAY_API_URL=https://api.danarapay.com
DANARAPAY_USERNAME=...
DANARAPAY_API_KEY=...
```
