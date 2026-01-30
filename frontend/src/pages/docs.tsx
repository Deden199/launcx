// File: src/pages/docs.tsx
'use client'
import { NextPage } from 'next'
import React from 'react'
import styles from './DocsPage.module.css'

/**
 * Complete documentation of the Launcx API integration for partner clients.
 * Supports Production & Staging environments.
 * Explains authentication headers, transaction flow, callbacks, and dashboard.
 */

const IntegrationDocs: NextPage & { disableLayout?: boolean } = () => (
  <main className={styles.container}>
    {/* ─────────────────────────────────────────────── TITLE */}
    <h1 className={styles.heading1}>Launcx API Integration Guide</h1>

    {/* ──────────────────────────────── ENVIRONMENT & BASE URL */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>Environment & Base URLs</h2>
      <ul className={styles.list}>
        <li><strong>Production:</strong> <code>https://s2.launcx.com/api/v1</code></li>
        <li><strong>Staging:</strong> <code>https://staging.launcx.com/api/v1</code></li>
      </ul>
      <p className={styles.bodyText}>
        Use the base URL according to your environment. All endpoints are under <code>/api/v1</code>.
      </p>
    </section>

    {/* ─────────────────────────────────── 1. Authentication */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>1. Authentication</h2>
      <p className={styles.bodyText}>
        Every request to <code>/api/v1/*</code> <strong>must</strong> include the following headers:
      </p>
      <ul className={styles.list}>
        <li><code>Content-Type: application/json</code></li>
        <li><code>X-API-Key: &lt;YOUR_API_KEY&gt;</code></li>
        <li><code>X-Timestamp: &lt;Unix TS ms&gt;</code> (rejected if difference &gt; 5 minutes)</li>
      </ul>
      <pre className={styles.codeBlock}><code>{`import axios from 'axios'

const api = axios.create({
  baseURL: 'https://s2.launcx.com/api/v1',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.LAUNCX_API_KEY!,
  },
})

api.interceptors.request.use(cfg => {
  cfg.headers['X-Timestamp'] = Date.now().toString()
  return cfg
})

export default api`}</code></pre>
    </section>

    {/* ─────────────────────────────────── 2. Payment Methods */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>2. Payment Methods</h2>
      <p className={styles.bodyText}>
        Launcx mendukung dua metode pembayaran:
      </p>
      <ul className={styles.list}>
        <li><strong>QRIS</strong> – Quick Response Code Indonesia Standard</li>
        <li><strong>Virtual Account (VA)</strong> – Transfer bank via nomor VA</li>
      </ul>
    </section>

    {/* ─────────────────────────────────── 3. QRIS Payment */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>3. QRIS Payment</h2>
      <p className={styles.bodyText}>
        Endpoint: <code>POST /payments</code> supports two flows:
      </p>

      {/* Embed Flow */}
      <h3 className={styles.heading3}>3.1 Embed Flow</h3>
      <pre className={styles.codeBlock}><code>{`POST /api/v1/payments
Headers:
  Content-Type: application/json
  X-API-Key: <YOUR_API_KEY>
  X-Timestamp: <Unix TS ms>

Body:
{
  "price": 50000,
  "playerId": "user_123",
  "flow": "embed"
}`}</code></pre>
      <p className={styles.bodyText}>Response <code>201 Created</code>:</p>
      <pre className={styles.codeBlock}><code>{`{
  "success": true,
  "data": {
    "orderId": "685s6eb9263c75af53ba84b1",
    "checkoutUrl": "https://s2.launcx.com/checkout/{orderId}",
    "qrPayload": "0002010102122667...47B8",
    "playerId": "user_123",
    "totalAmount": 50000,
    "expiredTs": "2025-01-30T15:30:00Z"
  }
}`}</code></pre>

      {/* Redirect Flow */}
      <h3 className={styles.heading3}>3.2 Redirect Flow</h3>
      <pre className={styles.codeBlock}><code>{`POST /api/v1/payments
Body:
{
  "price": 50000,
  "playerId": "user_123",
  "flow": "redirect"
}`}</code></pre>
      <p className={styles.bodyText}>Response <code>303 See Other</code>:</p>
      <pre className={styles.codeBlock}><code>{`HTTP/1.1 303 See Other
Location: https://s2.launcx.com/checkout/685e6f36263c75af53ba84b3`}</code></pre>

      <h4 className={styles.heading3}>cURL Example</h4>
      <pre className={styles.codeBlock}><code>{`TS=$(date +%s000)

curl -X POST https://s2.launcx.com/api/v1/payments \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: <YOUR_API_KEY>" \\
  -H "X-Timestamp: $TS" \\
  -d '{
    "price": 50000,
    "playerId": "user_123"
  }'`}</code></pre>
    </section>

    {/* ─────────────────────────────────── 4. Virtual Account (VA) */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>4. Virtual Account (VA)</h2>
      <p className={styles.bodyText}>
        Virtual Account memungkinkan customer melakukan pembayaran via transfer bank.
      </p>

      {/* 4.1 Create VA */}
      <h3 className={styles.heading3}>4.1 Create VA</h3>
      <pre className={styles.codeBlock}><code>{`POST /api/v1/payments/va-aggregator/va/create
Headers:
  Content-Type: application/json
  X-API-Key: <YOUR_API_KEY>
  X-Timestamp: <Unix TS ms>

Body:
{
  "partner_user_id": "user_123",
  "bank_code": "008",
  "amount": 50000,
  "is_open": false,
  "is_single_use": true,
  "expiration_time": 1440,
  "username_display": "John Doe",
  "partner_trx_id": "TRX-001"
}`}</code></pre>

      <p className={styles.bodyText}><strong>Request Parameters:</strong></p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Required</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>partner_user_id</td><td>string</td><td>Yes</td><td>Unique identifier untuk user</td></tr>
          <tr><td>bank_code</td><td>string</td><td>Yes</td><td>Kode bank: 002 (BRI), 008 (Mandiri), 009 (BNI), 013 (Permata), 022 (CIMB)</td></tr>
          <tr><td>amount</td><td>number</td><td>No</td><td>Nominal pembayaran (wajib jika is_open=false)</td></tr>
          <tr><td>is_open</td><td>boolean</td><td>No</td><td>true = open amount, false = closed amount (default: true)</td></tr>
          <tr><td>is_single_use</td><td>boolean</td><td>No</td><td>true = VA ditutup setelah pembayaran (default: false)</td></tr>
          <tr><td>expiration_time</td><td>number</td><td>No</td><td>Waktu expired dalam menit (default: 1440 = 24 jam)</td></tr>
          <tr><td>is_lifetime</td><td>boolean</td><td>No</td><td>true = VA tidak pernah expired</td></tr>
          <tr><td>username_display</td><td>string</td><td>Yes</td><td>Nama yang ditampilkan ke user (min 3 karakter)</td></tr>
          <tr><td>partner_trx_id</td><td>string</td><td>No</td><td>ID transaksi unik dari partner</td></tr>
          <tr><td>trx_expiration_time</td><td>number</td><td>No</td><td>Waktu expired transaksi dalam menit</td></tr>
        </tbody>
      </table>

      <p className={styles.bodyText}>Response <code>200 OK</code>:</p>
      <pre className={styles.codeBlock}><code>{`{
  "success": true,
  "data": {
    "id": "19cc351e-cd81-4300-af19-ecac8e3a3144",
    "va_number": "8618830003000000039",
    "bank_code": "008",
    "amount": 50000,
    "partner_user_id": "user_123",
    "partner_trx_id": "TRX-001",
    "is_open": false,
    "is_single_use": true,
    "expiration_time": 1769782380000,
    "trx_expiration_time": 1769782380000,
    "va_status": "WAITING_PAYMENT",
    "username_display": "John Doe"
  }
}`}</code></pre>

      <h4 className={styles.heading3}>cURL Example</h4>
      <pre className={styles.codeBlock}><code>{`TS=$(date +%s000)

curl -X POST https://s2.launcx.com/api/v1/payments/va-aggregator/va/create \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: <YOUR_API_KEY>" \\
  -H "X-Timestamp: $TS" \\
  -d '{
    "partner_user_id": "user_123",
    "bank_code": "008",
    "amount": 50000,
    "is_open": false,
    "is_single_use": true,
    "expiration_time": 1440,
    "username_display": "John Doe",
    "partner_trx_id": "TRX-001"
  }'`}</code></pre>

      {/* 4.2 Get VA Info */}
      <h3 className={styles.heading3}>4.2 Get VA Info</h3>
      <pre className={styles.codeBlock}><code>{`GET /api/v1/payments/va-aggregator/va/info/{vaId}
Headers:
  X-API-Key: <YOUR_API_KEY>
  X-Timestamp: <Unix TS ms>`}</code></pre>

      <p className={styles.bodyText}>Response:</p>
      <pre className={styles.codeBlock}><code>{`{
  "success": true,
  "data": {
    "id": "19cc351e-cd81-4300-af19-ecac8e3a3144",
    "va_number": "8618830003000000039",
    "bank_code": "008",
    "bank_name": "Mandiri",
    "amount": 50000,
    "va_status": "WAITING_PAYMENT",
    "created": "2025-01-30T10:00:00Z"
  }
}`}</code></pre>

      {/* 4.3 Update VA */}
      <h3 className={styles.heading3}>4.3 Update VA</h3>
      <pre className={styles.codeBlock}><code>{`PUT /api/v1/payments/va-aggregator/va/update/{vaId}
Headers:
  Content-Type: application/json
  X-API-Key: <YOUR_API_KEY>
  X-Timestamp: <Unix TS ms>

Body:
{
  "amount": 75000,
  "username_display": "Jane Doe"
}`}</code></pre>

      {/* 4.4 Bank Codes */}
      <h3 className={styles.heading3}>4.4 Supported Banks</h3>
      <table className={styles.table}>
        <thead>
          <tr><th>Bank Code</th><th>Bank Name</th></tr>
        </thead>
        <tbody>
          <tr><td>002</td><td>BRI</td></tr>
          <tr><td>008</td><td>Mandiri</td></tr>
          <tr><td>009</td><td>BNI</td></tr>
          <tr><td>013</td><td>Permata</td></tr>
          <tr><td>022</td><td>CIMB Niaga</td></tr>
        </tbody>
      </table>

      {/* 4.5 VA Status */}
      <h3 className={styles.heading3}>4.5 VA Status</h3>
      <table className={styles.table}>
        <thead>
          <tr><th>Status</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td>WAITING_PAYMENT</td><td>VA aktif, menunggu pembayaran</td></tr>
          <tr><td>PAYMENT_DETECTED</td><td>Pembayaran terdeteksi</td></tr>
          <tr><td>COMPLETE</td><td>Pembayaran selesai</td></tr>
          <tr><td>EXPIRED</td><td>VA sudah expired</td></tr>
        </tbody>
      </table>
    </section>

    {/* ─────────────────────────────────── 5. Callback */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>5. Callback</h2>
      
      <h3 className={styles.heading3}>5.1 Register Callback URL</h3>
      <p className={styles.bodyText}>
        Register your endpoint in the Client Dashboard before receiving callbacks.
      </p>
      <pre className={styles.codeBlock}><code>{`POST /api/v1/client/callback-url
Authorization: Bearer <YOUR_JWT_TOKEN>
Content-Type: application/json

Body:
{
  "url": "https://your-server.com/api/callback"
}`}</code></pre>

      <h3 className={styles.heading3}>5.2 Callback Payload (QRIS)</h3>
      <p className={styles.bodyText}>
        Launcx will POST to your URL when transaction status changes:
      </p>
      <pre className={styles.codeBlock}><code>{`{
  "orderId": "685d4578f2745f068c635f17",
  "status": "PAID",
  "settlementStatus": "PENDING",
  "grossAmount": 50000,
  "feeLauncx": 500,
  "netAmount": 49500,
  "qrPayload": "00020101021226...",
  "playerId": "user_123",
  "timestamp": "2025-01-30T14:30:00Z",
  "nonce": "uuid-v4"
}`}</code></pre>

      <h3 className={styles.heading3}>5.3 Callback Payload (VA)</h3>
      <pre className={styles.codeBlock}><code>{`{
  "orderId": "19cc351e-cd81-4300-af19-ecac8e3a3144",
  "status": "SUCCESS",
  "channel": "VA",
  "vaNumber": "8618830003000000039",
  "bankCode": "008",
  "grossAmount": 50000,
  "feeLauncx": 500,
  "netAmount": 49500,
  "playerId": "user_123",
  "timestamp": "2025-01-30T14:30:00Z",
  "nonce": "uuid-v4"
}`}</code></pre>

      <h3 className={styles.heading3}>5.4 Verify Signature</h3>
      <p className={styles.bodyText}>
        The HMAC-SHA256 signature is in the <code>X-Callback-Signature</code> header:
      </p>
      <pre className={styles.codeBlock}><code>{`import crypto from 'crypto'

function verifyCallback(body, signature, secret) {
  const payload = JSON.stringify(body)
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  return signature === expected
}`}</code></pre>

      <h3 className={styles.heading3}>5.5 Retry Callback</h3>
      <p className={styles.bodyText}>
        If callback failed, retry manually:
      </p>
      <pre className={styles.codeBlock}><code>{`POST /api/v1/client/callbacks/{orderId}/retry
Authorization: Bearer <YOUR_JWT_TOKEN>`}</code></pre>
    </section>

    {/* ─────────────────────────────────── 6. Client Dashboard */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>6. Client Dashboard</h2>
      <p className={styles.bodyText}>
        Access the Dashboard at <code>https://s2.launcx.com/client/dashboard</code>. Features:
      </p>
      <ul className={styles.list}>
        <li><strong>QRIS Dashboard</strong> (<code>/client/dashboard</code>): Monitor transaksi QRIS</li>
        <li><strong>VA Dashboard</strong> (<code>/client/va-dashboard</code>): Monitor transaksi & VA aktif</li>
        <li><strong>Active Balance</strong>: Saldo aktif</li>
        <li><strong>Transaction History</strong>: Riwayat transaksi dengan filter</li>
        <li><strong>Callback Settings</strong>: Konfigurasi URL callback</li>
        <li><strong>Withdraw</strong>: Request penarikan dana</li>
      </ul>
    </section>

    {/* ─────────────────────────────────── 7. Status Codes */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>7. Transaction Status</h2>
      <table className={styles.table}>
        <thead>
          <tr><th>Status</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td>PENDING</td><td>Menunggu pembayaran</td></tr>
          <tr><td>PAID</td><td>Pembayaran diterima, menunggu settlement</td></tr>
          <tr><td>SUCCESS</td><td>Transaksi berhasil</td></tr>
          <tr><td>EXPIRED</td><td>Transaksi expired</td></tr>
          <tr><td>FAILED</td><td>Transaksi gagal</td></tr>
        </tbody>
      </table>
    </section>

    {/* ─────────────────────────────────── 8. Error Codes */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>8. Error Responses</h2>
      <pre className={styles.codeBlock}><code>{`{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}`}</code></pre>
      <table className={styles.table}>
        <thead>
          <tr><th>HTTP Code</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td>400</td><td>Bad Request - Invalid parameters</td></tr>
          <tr><td>401</td><td>Unauthorized - Invalid or missing API key</td></tr>
          <tr><td>404</td><td>Not Found - Resource not found</td></tr>
          <tr><td>500</td><td>Internal Server Error</td></tr>
        </tbody>
      </table>
    </section>

    {/* ─────────────────────────────────── 9. End-to-End Flow */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>9. Integration Flow</h2>
      
      <h3 className={styles.heading3}>9.1 QRIS Flow</h3>
      <ol className={styles.list}>
        <li>Login ke Dashboard & dapatkan <code>API Key</code></li>
        <li>Register Callback URL di Dashboard</li>
        <li>Create Order (<code>POST /payments</code>)</li>
        <li>Tampilkan QR Code ke customer atau redirect ke checkout</li>
        <li>Terima Callback & verify signature</li>
        <li>Update status di sistem Anda</li>
      </ol>

      <h3 className={styles.heading3}>9.2 VA Flow</h3>
      <ol className={styles.list}>
        <li>Login ke Dashboard & dapatkan <code>API Key</code></li>
        <li>Register Callback URL di Dashboard</li>
        <li>Create VA (<code>POST /payments/va-aggregator/va/create</code>)</li>
        <li>Tampilkan nomor VA & bank ke customer</li>
        <li>Customer transfer ke nomor VA</li>
        <li>Terima Callback & verify signature</li>
        <li>Update status di sistem Anda</li>
      </ol>
    </section>

    {/* ─────────────────────────────────── 10. Support */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>10. Support</h2>
      <p className={styles.bodyText}>
        Untuk bantuan teknis, hubungi tim support Launcx.
      </p>
    </section>
  </main>
)

IntegrationDocs.disableLayout = true
export default IntegrationDocs
