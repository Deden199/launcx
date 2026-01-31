// File: src/pages/docs.tsx
'use client'
import { NextPage } from 'next'
import React from 'react'
import styles from './DocsPage.module.css'

/**
 * Launcx API Integration Guide - Client Documentation
 * Provider-agnostic documentation for partner clients.
 * 
 * IMPORTANT: This documentation is client-facing.
 * - Do NOT expose internal provider names
 * - Do NOT expose internal callback paths
 * - Use generic endpoints only
 * - Focus on VA for initial launch
 */

const IntegrationDocs: NextPage & { disableLayout?: boolean } = () => (
  <main className={styles.container}>
    {/* ─────────────────────────────────────────────── TITLE */}
    <h1 className={styles.heading1}>Launcx API Integration Guide</h1>
    <p className={styles.bodyText} style={{ marginTop: '-1rem', color: '#888' }}>
      Virtual Account Payment Gateway
    </p>

    {/* ──────────────────────────────── ENVIRONMENT & BASE URL */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>Environment & Base URLs</h2>
      <ul className={styles.list}>
        <li><strong>Production:</strong> <code>https://{'{LAUNCX_DOMAIN}'}/api/v1</code></li>
        <li><strong>Staging:</strong> <code>https://{'{LAUNCX_STAGING_DOMAIN}'}/api/v1</code></li>
      </ul>
      <p className={styles.bodyText}>
        Hubungi tim Launcx untuk mendapatkan domain production dan staging Anda.
        Semua endpoint berada di bawah <code>/api/v1</code>.
      </p>
    </section>

    {/* ─────────────────────────────────── 1. Authentication */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>1. Authentication</h2>
      <p className={styles.bodyText}>
        Setiap request ke <code>/api/v1/*</code> <strong>wajib</strong> menyertakan header berikut:
      </p>
      <ul className={styles.list}>
        <li><code>Content-Type: application/json</code></li>
        <li><code>X-API-Key: &lt;YOUR_API_KEY&gt;</code></li>
        <li><code>X-Timestamp: &lt;Unix TS ms&gt;</code> (ditolak jika selisih &gt; 5 menit)</li>
      </ul>
      <pre className={styles.codeBlock}><code>{`import axios from 'axios'

const api = axios.create({
  baseURL: process.env.LAUNCX_BASE_URL, // e.g., https://api.launcx.com/api/v1
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

    {/* ─────────────────────────────────── 2. Virtual Account (VA) */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>2. Virtual Account (VA)</h2>
      <p className={styles.bodyText}>
        Virtual Account memungkinkan customer melakukan pembayaran via transfer bank.
        Provider VA dipilih otomatis oleh Launcx.
      </p>

      {/* 2.1 Create VA */}
      <h3 className={styles.heading3}>2.1 Create VA</h3>
      <pre className={styles.codeBlock}><code>{`POST /api/v1/payments/va
Headers:
  Content-Type: application/json
  X-API-Key: <YOUR_API_KEY>
  X-Timestamp: <Unix TS ms>

Body:
{
  "customerId": "user_123",
  "bankCode": "008",
  "amount": 50000,
  "isOpen": false,
  "isSingleUse": true,
  "expirationMinutes": 1440,
  "displayName": "John Doe",
  "referenceId": "TRX-001"
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
          <tr><td>customerId</td><td>string</td><td>Yes</td><td>Unique identifier untuk customer Anda</td></tr>
          <tr><td>bankCode</td><td>string</td><td>Yes</td><td>Kode bank (lihat tabel di bawah)</td></tr>
          <tr><td>amount</td><td>number</td><td>Conditional</td><td>Nominal pembayaran (wajib jika isOpen=false)</td></tr>
          <tr><td>isOpen</td><td>boolean</td><td>No</td><td>true = open amount, false = fixed amount (default: true)</td></tr>
          <tr><td>isSingleUse</td><td>boolean</td><td>No</td><td>true = VA ditutup setelah pembayaran (default: false)</td></tr>
          <tr><td>expirationMinutes</td><td>number</td><td>No</td><td>Waktu expired dalam menit (default: 1440 = 24 jam)</td></tr>
          <tr><td>isLifetime</td><td>boolean</td><td>No</td><td>true = VA tidak pernah expired</td></tr>
          <tr><td>displayName</td><td>string</td><td>Yes</td><td>Nama yang ditampilkan ke customer (min 3 karakter)</td></tr>
          <tr><td>referenceId</td><td>string</td><td>No</td><td>ID transaksi unik dari sistem Anda</td></tr>
        </tbody>
      </table>

      <p className={styles.bodyText}>Response <code>200 OK</code>:</p>
      <pre className={styles.codeBlock}><code>{`{
  "success": true,
  "data": {
    "id": "19cc351e-cd81-4300-af19-ecac8e3a3144",
    "vaNumber": "8618830003000000039",
    "bankCode": "008",
    "bankName": "Mandiri",
    "amount": 50000,
    "customerId": "user_123",
    "referenceId": "TRX-001",
    "isOpen": false,
    "isSingleUse": true,
    "expiresAt": "2025-01-31T10:00:00Z",
    "status": "PENDING",
    "displayName": "John Doe"
  }
}`}</code></pre>

      <h4 className={styles.heading3}>cURL Example</h4>
      <pre className={styles.codeBlock}><code>{`TS=$(date +%s000)

curl -X POST $LAUNCX_BASE_URL/payments/va \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: <YOUR_API_KEY>" \\
  -H "X-Timestamp: $TS" \\
  -d '{
    "customerId": "user_123",
    "bankCode": "008",
    "amount": 50000,
    "isOpen": false,
    "isSingleUse": true,
    "expirationMinutes": 1440,
    "displayName": "John Doe",
    "referenceId": "TRX-001"
  }'`}</code></pre>

      {/* 2.2 Get VA Info */}
      <h3 className={styles.heading3}>2.2 Get VA Info</h3>
      <pre className={styles.codeBlock}><code>{`GET /api/v1/payments/va/{vaId}
Headers:
  X-API-Key: <YOUR_API_KEY>
  X-Timestamp: <Unix TS ms>`}</code></pre>

      <p className={styles.bodyText}>Response:</p>
      <pre className={styles.codeBlock}><code>{`{
  "success": true,
  "data": {
    "id": "19cc351e-cd81-4300-af19-ecac8e3a3144",
    "vaNumber": "8618830003000000039",
    "bankCode": "008",
    "bankName": "Mandiri",
    "amount": 50000,
    "status": "PENDING",
    "createdAt": "2025-01-30T10:00:00Z",
    "expiresAt": "2025-01-31T10:00:00Z"
  }
}`}</code></pre>

      {/* 2.3 Update VA */}
      <h3 className={styles.heading3}>2.3 Update VA</h3>
      <pre className={styles.codeBlock}><code>{`PUT /api/v1/payments/va/{vaId}
Headers:
  Content-Type: application/json
  X-API-Key: <YOUR_API_KEY>
  X-Timestamp: <Unix TS ms>

Body:
{
  "amount": 75000,
  "displayName": "Jane Doe"
}`}</code></pre>

      {/* 2.4 Bank Codes */}
      <h3 className={styles.heading3}>2.4 Supported Banks</h3>
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
      <p className={styles.bodyText}>
        <em>Ketersediaan bank dapat berbeda berdasarkan konfigurasi tenant Anda.</em>
      </p>
    </section>

    {/* ─────────────────────────────────── 3. Transaction Status */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>3. Transaction Status</h2>
      <p className={styles.bodyText}>
        Berikut adalah status transaksi yang akan Anda terima:
      </p>
      
      <h3 className={styles.heading3}>3.1 Payment Status</h3>
      <table className={styles.table}>
        <thead>
          <tr><th>Status</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>PENDING</code></td><td>Menunggu pembayaran dari customer</td></tr>
          <tr><td><code>PAID</code></td><td>Pembayaran diterima, menunggu settlement</td></tr>
          <tr><td><code>SETTLED</code></td><td>Pembayaran sudah di-settle ke saldo Anda</td></tr>
          <tr><td><code>EXPIRED</code></td><td>Transaksi expired karena tidak dibayar</td></tr>
          <tr><td><code>FAILED</code></td><td>Transaksi gagal</td></tr>
        </tbody>
      </table>

      <h3 className={styles.heading3}>3.2 Settlement Status</h3>
      <table className={styles.table}>
        <thead>
          <tr><th>Status</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>WAITING</code></td><td>Menunggu proses settlement</td></tr>
          <tr><td><code>SUCCESS</code></td><td>Settlement berhasil, saldo sudah ditambahkan</td></tr>
          <tr><td><code>FAILED</code></td><td>Settlement gagal</td></tr>
        </tbody>
      </table>
    </section>

    {/* ─────────────────────────────────── 4. Callbacks */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>4. Callbacks</h2>
      <p className={styles.bodyText}>
        Launcx akan mengirim HTTP POST ke callback URL Anda saat status transaksi berubah.
      </p>
      
      <h3 className={styles.heading3}>4.1 Register Callback URL</h3>
      <p className={styles.bodyText}>
        Daftarkan endpoint Anda melalui Client Dashboard sebelum menerima callback.
      </p>

      <h3 className={styles.heading3}>4.2 Callback Payload</h3>
      <p className={styles.bodyText}>
        Format callback untuk transaksi VA:
      </p>
      <pre className={styles.codeBlock}><code>{`{
  "event": "payment.updated",
  "data": {
    "orderId": "19cc351e-cd81-4300-af19-ecac8e3a3144",
    "channel": "VA",
    "status": "SETTLED",
    "settlementStatus": "SUCCESS",
    "grossAmount": 50000,
    "fee": 500,
    "netAmount": 49500,
    "customerId": "user_123",
    "vaNumber": "8618830003000000039",
    "bankCode": "008",
    "bankName": "Mandiri",
    "occurredAt": "2025-01-30T14:30:00Z",
    "nonce": "550e8400-e29b-41d4-a716-446655440000"
  }
}`}</code></pre>

      <h3 className={styles.heading3}>4.3 Callback Events</h3>
      <table className={styles.table}>
        <thead>
          <tr><th>Event</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>payment.updated</code></td><td>Status transaksi berubah</td></tr>
          <tr><td><code>payment.expired</code></td><td>Transaksi expired</td></tr>
        </tbody>
      </table>

      <h3 className={styles.heading3}>4.4 Signature Verification</h3>
      <p className={styles.bodyText}>
        Setiap callback menyertakan signature di header <code>X-Callback-Signature</code>.
        <strong> Wajib</strong> verifikasi signature untuk keamanan.
      </p>
      <pre className={styles.codeBlock}><code>{`// Node.js signature verification
import crypto from 'crypto'

function verifyCallbackSignature(
  body: object, 
  signature: string, 
  secret: string
): boolean {
  // 1. Stringify body exactly as received
  const payload = JSON.stringify(body)
  
  // 2. Compute HMAC-SHA256
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  
  // 3. Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}

// Usage in Express handler
app.post('/api/launcx-callback', express.json(), (req, res) => {
  const signature = req.header('X-Callback-Signature')
  const secret = process.env.LAUNCX_CALLBACK_SECRET!
  
  if (!signature || !verifyCallbackSignature(req.body, signature, secret)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }
  
  // Process callback...
  const { event, data } = req.body
  console.log(\`Received \${event}: Order \${data.orderId} is \${data.status}\`)
  
  // Always respond 200 to acknowledge
  return res.json({ success: true })
})`}</code></pre>

      <h3 className={styles.heading3}>4.5 Callback Security Best Practices</h3>
      <ul className={styles.list}>
        <li><strong>Always verify signature</strong> - Jangan proses callback tanpa verifikasi</li>
        <li><strong>Use HTTPS</strong> - Callback URL wajib HTTPS</li>
        <li><strong>Idempotency</strong> - Handle duplicate callback dengan cek <code>nonce</code></li>
        <li><strong>Respond quickly</strong> - Respond 200 OK dalam 5 detik, proses async jika perlu</li>
      </ul>
    </section>

    {/* ─────────────────────────────────── 5. Withdrawal */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>5. Withdrawal</h2>
      <p className={styles.bodyText}>
        Tarik saldo Anda ke rekening bank melalui Dashboard atau API.
      </p>
      
      <h3 className={styles.heading3}>5.1 Create Withdrawal</h3>
      <pre className={styles.codeBlock}><code>{`POST /api/v1/client/withdrawals
Authorization: Bearer <YOUR_JWT_TOKEN>
Content-Type: application/json

Body:
{
  "amount": 1000000,
  "bankCode": "014",
  "accountNumber": "1234567890",
  "accountName": "John Doe"
}`}</code></pre>

      <h3 className={styles.heading3}>5.2 Withdrawal Status</h3>
      <table className={styles.table}>
        <thead>
          <tr><th>Status</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>PENDING</code></td><td>Withdrawal sedang diproses</td></tr>
          <tr><td><code>COMPLETED</code></td><td>Dana sudah dikirim ke rekening</td></tr>
          <tr><td><code>FAILED</code></td><td>Withdrawal gagal (saldo dikembalikan)</td></tr>
        </tbody>
      </table>
    </section>

    {/* ─────────────────────────────────── 6. Error Codes */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>6. Error Responses</h2>
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
          <tr><td>400</td><td>Bad Request - Parameter tidak valid</td></tr>
          <tr><td>401</td><td>Unauthorized - API key tidak valid atau signature salah</td></tr>
          <tr><td>404</td><td>Not Found - Resource tidak ditemukan</td></tr>
          <tr><td>429</td><td>Rate Limited - Terlalu banyak request</td></tr>
          <tr><td>500</td><td>Internal Server Error</td></tr>
        </tbody>
      </table>
    </section>

    {/* ─────────────────────────────────── 7. Integration Flow */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>7. Integration Flow</h2>
      
      <h3 className={styles.heading3}>VA Payment Flow</h3>
      <ol className={styles.list}>
        <li>Login ke Dashboard & dapatkan <code>API Key</code></li>
        <li>Register Callback URL di Dashboard</li>
        <li>Create VA via <code>POST /payments/va</code></li>
        <li>Tampilkan nomor VA & bank ke customer</li>
        <li>Customer transfer ke nomor VA</li>
        <li>Terima Callback dengan status <code>PAID</code> / <code>SETTLED</code></li>
        <li>Verify signature & update status di sistem Anda</li>
      </ol>
    </section>

    {/* ─────────────────────────────────── 8. SDK */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>8. SDK / Code Examples</h2>
      
      <h3 className={styles.heading3}>8.1 Node.js / TypeScript Client</h3>
      <pre className={styles.codeBlock}><code>{`// launcx-client.ts
import axios, { AxiosInstance } from 'axios'

interface LauncxConfig {
  apiKey: string
  baseURL: string  // e.g., https://api.launcx.com/api/v1
}

interface CreateVAParams {
  customerId: string
  bankCode: string
  amount?: number
  isOpen?: boolean
  isSingleUse?: boolean
  expirationMinutes?: number
  displayName: string
  referenceId?: string
}

class LauncxClient {
  private client: AxiosInstance

  constructor(config: LauncxConfig) {
    this.client = axios.create({
      baseURL: config.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey,
      },
    })

    // Auto-add timestamp
    this.client.interceptors.request.use(cfg => {
      cfg.headers['X-Timestamp'] = Date.now().toString()
      return cfg
    })
  }

  // ─── VA ─────────────────────────────────────────
  async createVA(params: CreateVAParams) {
    const { data } = await this.client.post('/payments/va', params)
    return data
  }

  async getVA(vaId: string) {
    const { data } = await this.client.get(\`/payments/va/\${vaId}\`)
    return data
  }

  async updateVA(vaId: string, params: Partial<CreateVAParams>) {
    const { data } = await this.client.put(\`/payments/va/\${vaId}\`, params)
    return data
  }
}

export default LauncxClient`}</code></pre>

      <h3 className={styles.heading3}>8.2 Usage Example</h3>
      <pre className={styles.codeBlock}><code>{`import LauncxClient from './launcx-client'

const launcx = new LauncxClient({
  apiKey: process.env.LAUNCX_API_KEY!,
  baseURL: process.env.LAUNCX_BASE_URL!,
})

// Create VA
async function createPayment(userId: string, amount: number) {
  const result = await launcx.createVA({
    customerId: userId,
    bankCode: '008', // Mandiri
    amount: amount,
    isOpen: false,
    isSingleUse: true,
    expirationMinutes: 1440, // 24 hours
    displayName: 'Customer Name',
    referenceId: \`TRX-\${Date.now()}\`,
  })

  console.log('VA Number:', result.data.vaNumber)
  console.log('Bank:', result.data.bankName)
  console.log('Expires:', result.data.expiresAt)
  
  return result.data
}`}</code></pre>

      <h3 className={styles.heading3}>8.3 Callback Handler</h3>
      <pre className={styles.codeBlock}><code>{`import express from 'express'
import crypto from 'crypto'

const router = express.Router()

function verifySignature(body: any, signature: string, secret: string): boolean {
  const payload = JSON.stringify(body)
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  
  if (signature.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

router.post('/launcx-callback', express.json(), async (req, res) => {
  const signature = req.header('X-Callback-Signature')
  const secret = process.env.LAUNCX_CALLBACK_SECRET!

  // 1. Verify signature
  if (!signature || !verifySignature(req.body, signature, secret)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const { event, data } = req.body
  const { orderId, status, settlementStatus, vaNumber, bankName, netAmount, customerId, nonce } = data

  // 2. Check idempotency (prevent duplicate processing)
  const alreadyProcessed = await checkNonceProcessed(nonce)
  if (alreadyProcessed) {
    return res.json({ success: true, message: 'Already processed' })
  }

  // 3. Process based on status
  console.log(\`[VA] Order \${orderId}: \${status} (settlement: \${settlementStatus})\`)
  console.log(\`VA: \${vaNumber} (\${bankName}), Amount: \${netAmount}\`)

  if (status === 'SETTLED' && settlementStatus === 'SUCCESS') {
    // Payment fully settled - update your system
    await updateOrderStatus(orderId, 'completed', netAmount)
    await notifyUser(customerId, 'Payment successful!')
  } else if (status === 'EXPIRED') {
    await handleExpiredOrder(orderId)
  } else if (status === 'FAILED') {
    await handleFailedOrder(orderId)
  }

  // 4. Mark nonce as processed
  await markNonceProcessed(nonce)

  // 5. Acknowledge
  return res.json({ success: true })
})

export default router`}</code></pre>
    </section>

    {/* ─────────────────────────────────── 9. Dashboard */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>9. Client Dashboard</h2>
      <p className={styles.bodyText}>
        Akses Dashboard di <code>https://{'{LAUNCX_DOMAIN}'}/client/dashboard</code>. Fitur:
      </p>
      <ul className={styles.list}>
        <li><strong>Transaction Dashboard</strong> - Monitor semua transaksi VA</li>
        <li><strong>Balance</strong> - Lihat saldo aktif dan pending</li>
        <li><strong>Withdrawal</strong> - Request penarikan dana</li>
        <li><strong>Settings</strong> - Konfigurasi callback URL dan API keys</li>
      </ul>
    </section>

    {/* ─────────────────────────────────── 10. Support */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>10. Support</h2>
      <p className={styles.bodyText}>
        Untuk bantuan teknis, hubungi tim support Launcx melalui Dashboard atau email.
      </p>
    </section>
  </main>
)

IntegrationDocs.disableLayout = true
export default IntegrationDocs
