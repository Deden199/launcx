# Launcx Platform Documentation

Welcome to the Launcx platform documentation. This directory contains comprehensive guides for developers integrating with the Launcx payment and withdrawal system.

---

## 📚 Documentation Structure

```
docs/
├── README.md (this file)
├── providers/
│   └── ing1/
│       ├── README.md - Complete ING1 provider documentation
│       └── CURL_EXAMPLES.md - cURL examples for ING1
└── api-collections/
    └── (API collection files)
```

---

## 🚀 Quick Start

### For ING1 Integration

1. **Read the provider documentation:**
   - [ING1 Provider Guide](./providers/ing1/README.md)

2. **Try the cURL examples:**
   - [ING1 cURL Examples](./providers/ing1/CURL_EXAMPLES.md)

3. **Set up your environment:**
   - Configure ING1 credentials in `sub_merchant` collection
   - Set `defaultProvider: "ing1"` in partner client config
   - Update callback URLs

4. **Test the integration:**
   - Use sandbox credentials
   - Test payment flow
   - Test withdrawal flow
   - Verify callbacks

---

## 📖 Provider Documentation

### Available Providers

| Provider | Payment | Withdrawal | Documentation |
|----------|---------|------------|---------------|
| **ING1** | ✅ | ✅ | [ING1 Docs](./providers/ing1/README.md) |
| Hilogate | ✅ | ✅ | Coming soon |
| OY | ✅ | ✅ | Coming soon |
| GIDI | ✅ | ✅ | Coming soon |
| Piro | ✅ | ✅ | Coming soon |
| Genesis | ✅ | ✅ | Coming soon |

---

## 🔑 Key Concepts

### Payment Flow
1. **Create Transaction** - Client initiates payment
2. **Customer Pays** - Customer completes payment via QR/link
3. **Callback Received** - Provider sends payment notification
4. **Status Updated** - System updates order status
5. **Settlement** - Funds are settled to merchant account

### Withdrawal Flow
1. **Select Wallet** - Choose sub-merchant wallet
2. **Validate Account** - Verify bank account details
3. **Create Withdrawal** - Initiate withdrawal request
4. **Processing** - Provider processes transfer
5. **Callback Received** - Provider sends status update
6. **Completion** - Funds transferred or refunded

---

## 🛠️ API Endpoints

### Payment Endpoints
- `POST /api/v1/transactions` - Create payment
- `GET /api/v1/orders/{orderId}` - Check payment status
- `GET /api/v1/payment/{provider}/callback` - Payment callback

### Withdrawal Endpoints
- `GET /api/v1/client/withdrawals/sub-merchants` - List wallets
- `POST /api/v1/client/withdrawals/validate` - Validate account
- `POST /api/v1/client/withdrawals` - Create withdrawal
- `GET /api/v1/client/withdrawals` - List withdrawals
- `GET /api/v1/withdrawals/{provider}/callback` - Withdrawal callback

### Administrative Endpoints
- `POST /api/v1/internal/query-pending-{provider}-withdrawals` - Query pending
- `POST /api/v1/withdrawals/{id}/retry` - Retry withdrawal

---

## 🔐 Authentication

### Bearer Token (Dashboard)
Used for web dashboard and client applications:
```bash
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### API Key (Server-to-Server)
Used for backend integrations:
```bash
X-API-Key: a240f00aba8cdb2d8622ae778fa36598
```

---

## 📊 Status Codes

### Payment Status
- `PENDING` - Awaiting payment
- `PAID` - Payment received
- `SUCCESS` / `DONE` / `SETTLED` - Completed
- `EXPIRED` - Payment timeout
- `FAILED` - Payment failed

### Withdrawal Status
- `PENDING` - Processing
- `COMPLETED` - Success
- `FAILED` - Failed (refunded)

---

## 🧪 Testing

### Test Credentials
Each provider has sandbox/test credentials. See provider-specific documentation.

### Test Endpoints
Use `http://localhost:5000` for local development.

### Simulating Callbacks
Each provider documentation includes callback simulation examples.

---

## 📁 File References

### Core Files
- `src/controller/payment.ts` - Payment controller
- `src/controller/withdrawals.controller.ts` - Withdrawal controller
- `src/service/*Client.ts` - Provider client implementations
- `src/service/*Status.ts` - Status mapping utilities
- `src/service/*Fallback.ts` - Fallback mechanisms

### Configuration
- `src/prisma/schema.prisma` - Database schema
- `src/config.ts` - Application configuration
- `.env` or `env.txt` - Environment variables

### Routes
- `src/route/payment.callback.routes.ts` - Payment callbacks
- `src/route/withdrawals.routes.ts` - Withdrawal routes
- `src/route/internal.routes.ts` - Admin routes

---

## 🔍 Common Issues

### Payment Not Updating
**Problem:** Payment completed but status not updated

**Solutions:**
1. Check callback URL is accessible
2. Verify callback was received (check database)
3. Run fallback service
4. Manually query status

### Withdrawal Stuck
**Problem:** Withdrawal pending for too long

**Solutions:**
1. Check provider callback was received
2. Run `/query-pending-{provider}-withdrawals`
3. Check provider dashboard
4. Contact provider support

### Balance Issues
**Problem:** Balance not updating correctly

**Solutions:**
1. Check transaction logs
2. Verify settlement status
3. Check for failed withdrawals
4. Audit balance calculations

---

## 📞 Support

### Documentation Issues
File an issue in the project repository with:
- Documentation file affected
- Description of the problem
- Suggested improvement

### Integration Help
For integration assistance:
1. Check provider-specific documentation
2. Review cURL examples
3. Check error logs
4. Contact technical team

---

## 🎯 Best Practices

### Payment Integration
1. Always handle callbacks asynchronously
2. Implement idempotency checks
3. Use fallback mechanisms
4. Log all provider responses
5. Monitor transaction status
6. Set appropriate timeouts
7. Test error scenarios

### Withdrawal Integration
1. Always validate accounts first
2. Check wallet balance before withdrawal
3. Handle 2FA properly
4. Implement proper error handling
5. Monitor pending withdrawals
6. Set up automatic status checks
7. Test refund scenarios

### Security
1. Secure API keys and tokens
2. Validate callback signatures
3. Use HTTPS for callbacks
4. Implement rate limiting
5. Log security events
6. Monitor for suspicious activity
7. Rotate credentials regularly

---

## 📅 Changelog

### October 2025
- Added ING1 provider documentation
- Added ING1 cURL examples
- Created documentation structure

---

## 🤝 Contributing

To contribute to documentation:
1. Follow existing format
2. Include complete examples
3. Test all cURL commands
4. Update this index
5. Submit pull request

---

## 📜 License

Internal documentation for Launcx platform.

---

**Last Updated:** October 2025
**Documentation Version:** 1.0
