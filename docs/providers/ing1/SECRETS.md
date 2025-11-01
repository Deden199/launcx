# ING1 / INACASH Provider Secrets Reference

This document contains the credential configuration for ING1 (INACASH) provider in both **Production** and **Staging** environments.

---

## Table of Contents

1. [Production Environment](#production-environment)
2. [Staging Environment](#staging-environment)
3. [Database Setup Commands](#database-setup-commands)
4. [Security Notes](#security-notes)

---

## Production Environment

### Provider Information
- **Provider Name:** ING1 / INACASH
- **Environment:** Production
- **Base URL:** `http://core.inacash.co.id/api`

### Credentials

```javascript
{
  baseUrl: "http://core.inacash.co.id/api",
  email: "logigits@gmail.com",
  password: "50571989",
  merchantId: "INA-00022000137",
  apiVersion: "v2"
}
```

### Merchant Details
- **Merchant Name:** LOGIGITS DIGITAL
- **Merchant ID (MID):** `INA-00022000137`
- **Email:** `logigits@gmail.com`
- **Password:** `50571989`

---

## Staging Environment

### Provider Information
- **Provider Name:** ING1 / INACASH
- **Environment:** Staging / Development
- **Base URL:** `https://api-dev.inacash.co.id/api`

### Credentials

```javascript
{
  baseUrl: "https://api-dev.inacash.co.id/api",
  email: "c@launcx.com",
  password: "44895985",
  merchantId: "INAC7417098799",
  apiVersion: "v2"  // Use v1 or v2 based on documentation
}
```

### Merchant Details
- **Email:** `c@launcx.com`
- **Password:** `44895985`
- **Merchant ID:** `INAC7417098799`
- **API Version:** v2 (use v2 if available in documentation, otherwise v1)

---

## Database Setup Commands

### Production Setup

#### 1. Create Parent Merchant (if not exists)

```javascript
db.merchant.insertOne({
  name: "LOGIGITS DIGITAL",
  phoneNumber: "+62xxxxxxxxxx",  // Update with actual phone
  email: "logigits@gmail.com",
  telegram: null,
  mdr: 0.0,
  createdAt: new Date(),
})
```

#### 2. Create Sub-Merchant for Production

```javascript
db.sub_merchant.insertOne({
  name: "ING1 / INACASH - Production",
  provider: "ing1",
  merchantId: ObjectId("PARENT_MERCHANT_ID_HERE"),  // Replace with actual parent merchant _id
  credentials: {
    baseUrl: "http://core.inacash.co.id/api",
    email: "logigits@gmail.com",
    password: "50571989",
    merchantId: "INA-00022000137",
    apiVersion: "v2",
    callbackUrl: "https://your-domain.com/api/v1/payment/ing1/callback"  // Update with actual domain
  },
  fee: 0.0,
  schedule: null,  // or "weekday" / "weekend"
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
})
```

### Staging Setup

#### 1. Create Parent Merchant for Staging (if not exists)

```javascript
db.merchant.insertOne({
  name: "Launcx Staging",
  phoneNumber: "+62xxxxxxxxxx",  // Update with actual phone
  email: "c@launcx.com",
  telegram: null,
  mdr: 0.0,
  createdAt: new Date(),
})
```

#### 2. Create Sub-Merchant for Staging

```javascript
db.sub_merchant.insertOne({
  name: "ING1 / INACASH - Staging",
  provider: "ing1",
  merchantId: ObjectId("PARENT_MERCHANT_ID_HERE"),  // Replace with actual parent merchant _id
  credentials: {
    baseUrl: "https://api-dev.inacash.co.id/api",
    email: "c@launcx.com",
    password: "44895985",
    merchantId: "INAC7417098799",
    apiVersion: "v2",  // Check documentation for correct version
    callbackUrl: "https://staging-domain.com/api/v1/payment/ing1/callback"  // Update with actual staging domain
  },
  fee: 0.0,
  schedule: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
})
```

### Update Existing Sub-Merchant

If you need to update credentials for an existing sub-merchant:

```javascript
// Update Production Credentials
db.sub_merchant.updateOne(
  { provider: "ing1", name: /Production/i },
  {
    $set: {
      "credentials.baseUrl": "http://core.inacash.co.id/api",
      "credentials.email": "logigits@gmail.com",
      "credentials.password": "50571989",
      "credentials.merchantId": "INA-00022000137",
      "credentials.apiVersion": "v2",
      updatedAt: new Date()
    }
  }
)

// Update Staging Credentials
db.sub_merchant.updateOne(
  { provider: "ing1", name: /Staging/i },
  {
    $set: {
      "credentials.baseUrl": "https://api-dev.inacash.co.id/api",
      "credentials.email": "c@launcx.com",
      "credentials.password": "44895985",
      "credentials.merchantId": "INAC7417098799",
      "credentials.apiVersion": "v2",
      updatedAt: new Date()
    }
  }
)
```

---

## Security Notes

1. **NEVER commit this file to version control**
   - Add `SECRETS.md` to `.gitignore`
   - Keep credentials encrypted in production databases
   - Use environment variables for sensitive data when possible

2. **Access Control**
   - Restrict access to this document to authorized personnel only
   - Store credentials in a secure password manager (1Password, LastPass, etc.)
   - Rotate passwords regularly (every 90 days recommended)

3. **Environment Separation**
   - Always keep production and staging credentials separate
   - Never use production credentials in development/staging
   - Test changes in staging before applying to production

4. **Callback URLs**
   - Ensure callback URLs use HTTPS in production
   - Whitelist callback IPs in firewall if possible
   - Monitor callback logs for suspicious activity

5. **Credential Validation**
   - Test credentials after setup using small test transactions
   - Monitor API logs for authentication errors
   - Keep backup of working credentials in secure location

6. **Data Protection**
   - Encrypt database backups containing credentials
   - Use TLS/SSL for all API communications
   - Implement rate limiting to prevent brute force attacks

7. **Incident Response**
   - If credentials are compromised, rotate immediately
   - Notify INACASH support to disable compromised accounts
   - Review access logs for unauthorized activity

---

## Quick Reference

### Production
- **URL:** http://core.inacash.co.id/api
- **Email:** logigits@gmail.com
- **MID:** INA-00022000137

### Staging
- **URL:** https://api-dev.inacash.co.id/api
- **Email:** c@launcx.com
- **MID:** INAC7417098799

---

## Related Documentation

- [ING1 Configuration Guide](./CONFIGURATION.md) - Full configuration setup
- [ING1 README](./README.md) - Provider overview and operations
- [ING1 Quick Start](./QUICK_START.md) - Getting started guide
- [ING1 CURL Examples](./CURL_EXAMPLES.md) - API request examples

---

**Last Updated:** October 2025
**Document Version:** 1.0
**Classification:** CONFIDENTIAL - Do Not Share