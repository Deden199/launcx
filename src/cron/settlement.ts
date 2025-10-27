// src/cron/settlement.ts
import * as cron from 'node-cron'                  // ✅ namespace import: aman untuk semua tsconfig
import type { ScheduledTask } from 'node-cron'
import axios from 'axios'
import https from 'https'
import os from 'os'
import pLimit from 'p-limit'
import { prisma } from '../core/prisma'
import { config } from '../config'
import crypto from 'crypto'
import logger from '../logger'
import { sendTelegramMessage } from '../core/telegram.axios'

// ————————— CONFIG —————————
const BATCH_SIZE = 1500                          // jumlah order PAID/LN_SETTLED diproses per batch
const HTTP_CONCURRENCY = Math.max(10, os.cpus().length * 2)
const DB_CONCURRENCY   = Number(process.env.DB_CONCURRENCY ?? os.cpus().length) // parallel DB transactions
const WORKER_CONCURRENCY = Number(process.env.SETTLEMENT_WORKERS ?? 1)
const DB_TX_TIMEOUT_MS = Number(process.env.SETTLEMENT_DB_TX_TIMEOUT_MS ?? 15_000)
const PARTNER_TX_CHUNK_SIZE = 50
const TZ = process.env.CRON_TZ || 'Asia/Jakarta' // ✅ TZ eksplisit biar gak nunggu UTC

type Cursor = { createdAt: Date; id: string } | null
// Status kandidat yang diperlakukan sama untuk proses settlement
const INPUT_SETTLEMENT_STATUSES: string[] = ['PAID', 'LN_SETTLED']

// HTTPS agent dengan keep-alive
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production',
  keepAlive: true
})

// retry helper untuk deadlock/write-conflict
async function retryTx(fn: () => Promise<any>, attempts = 5, baseDelayMs = 100) {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      const msg = (err.message ?? '').toLowerCase()
      const retryable = ['write conflict', 'transaction already closed', 'transaction timeout']
      const reason = retryable.find(r => msg.includes(r))
      if (i < attempts - 1 && reason) {
        const delay = baseDelayMs * 2 ** i
        logger.warn(`[SettlementCron] retryTx attempt ${i + 1} failed (${reason}), retrying in ${delay}ms…`, err.message)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

// signature helper
function generateSignature(path: string, secretKey: string): string {
  return crypto.createHash('md5').update(path + secretKey, 'utf8').digest('hex')
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

type SettlementResult = { netAmt: number; rrn: string; st: string; tmt?: Date; fee?: number }

type BatchResult = {
  hasMore: boolean
  settledCount: number
  netAmount: number
  lastCursor: Cursor
}

// ————————— CORE BATCH —————————
async function processBatch(cursor: Cursor): Promise<BatchResult> {
  const where: any = {
    status: { in: INPUT_SETTLEMENT_STATUSES },
    partnerClientId: { not: null },
    ...(cutoffTime && { createdAt: { lte: cutoffTime } }),
    ...(cursor
      ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }
      : {})
  }

  const pendingOrders = await prisma.order.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: BATCH_SIZE,
    select: {
      id: true,
      partnerClientId: true,
      pendingAmount: true,
      channel: true,
      createdAt: true,
      pgRefId: true,
      pgClientRef: true,
      subMerchant: { select: { id: true, credentials: true } }
    }
  })

  if (!pendingOrders.length) {
    return { hasMore: false, settledCount: 0, netAmount: 0, lastCursor: cursor }
  }

  const last = pendingOrders[pendingOrders.length - 1]
  const lastCursor: Cursor = { createdAt: last.createdAt, id: last.id }

  logger.info(`[SettlementCron] processing ${pendingOrders.length} orders`)

  const httpLimit = pLimit(HTTP_CONCURRENCY)
  type PendingOrder = (typeof pendingOrders)[number]
  const groups = new Map<string, { order: PendingOrder; settlement: SettlementResult }[]>()

  await Promise.all(
    pendingOrders.map(o =>
      httpLimit(async () => {
        try {
          const creds = o.subMerchant?.credentials as { merchantId: string; secretKey: string } | undefined
          if (!creds) return

          let settlementResult: SettlementResult | null = null
          const { merchantId, secretKey } = creds

          if (o.channel === 'hilogate') {
            const path = `/api/v1/transactions/${o.id}`
            const url = `${config.api.hilogate.baseUrl}${path}`
            const sig = generateSignature(path, secretKey)
            const resp = await axios.get(url, { headers: { 'X-Merchant-ID': merchantId, 'X-Signature': sig }, httpsAgent, timeout: 15_000 })
            const tx = resp.data.data
            const st = (tx.settlement_status || '').toUpperCase()
            if (!['ACTIVE', 'SETTLED', 'COMPLETED'].includes(st)) return
            settlementResult = {
              netAmt: o.pendingAmount ?? tx.net_amount,
              rrn: tx.rrn || 'N/A',
              st,
              tmt: tx.updated_at ? new Date(tx.updated_at) : undefined
            }
          } else if (o.channel === 'oy') {
            const statusResp = await axios.post(
              'https://partner.oyindonesia.com/api/payment-routing/check-status',
              { partner_trx_id: o.id, send_callback: false },
              { headers: { 'x-oy-username': merchantId, 'x-api-key': secretKey }, httpsAgent, timeout: 15_000 }
            )
            const s = statusResp.data
            const st = (s.settlement_status || '').toUpperCase()
            if (s.status?.code !== '000' || st === 'WAITING') return

            const detailResp = await axios.get('https://partner.oyindonesia.com/api/v1/transaction', {
              params: { partner_tx_id: o.id, product_type: 'PAYMENT_ROUTING' },
              headers: { 'x-oy-username': merchantId, 'x-api-key': secretKey },
              httpsAgent,
              timeout: 15_000
            })
            const d = detailResp.data.data
            if (!d || detailResp.data.status?.code !== '000') return

            settlementResult = {
              netAmt: d.settlement_amount,
              fee: d.admin_fee.total_fee,
              rrn: s.trx_id,
              st,
              tmt: d.settlement_time ? new Date(d.settlement_time) : undefined
            }
          } else if (o.channel === 'ing1' || o.channel === 'inacash') {
            // Inacash/ING1 settlement check (using Billers Engine API)
            const inaCreds = creds as any
            const baseUrl = inaCreds.baseUrl || 'https://core-dev.inacash.co.id/api'
            const apiVersion = inaCreds.apiVersion || 'v2'
            const email = inaCreds.email
            const password = inaCreds.password
            const productCode = inaCreds.productCode || 'QRIS_DIRECT'
            const custno = inaCreds.merchantId || inaCreds.custno

            // Get transaction reference (pgRefId is the INA reff)
            const pgRefId = o.pgRefId || o.id

            if (!email || !password || !custno) {
              logger.warn(`[SettlementCron] INA: missing credentials for order ${o.id}`)
              return
            }

            try {
              // Call INA Billers Engine API: POST {{BASE_URL}}/{{VERSION}}/transaction/cashin/check
              // Example: https://core-dev.inacash.co.id/api/v2/transaction/cashin/check
              const checkResp = await axios.post(
                `${baseUrl}/${apiVersion}/transaction/cashin/check`,
                {
                  product_code: productCode,
                  custno: custno,
                  reff: pgRefId,
                  email: email,
                  password: password
                },
                {
                  headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                  httpsAgent,
                  timeout: 15_000
                }
              )

              const resp = checkResp.data
              // rc: 0 = success, 91 = pending, 99 = failed
              if (resp.rc !== 0) {
                logger.debug(`[SettlementCron] INA order ${o.id} not ready (rc=${resp.rc})`)
                return // Not ready for settlement yet
              }

              const data = resp.data || {}
              const status = (data.status || resp.status || '').toUpperCase()

              // Check if payment is confirmed
              if (status !== 'PAID' && status !== 'COMPLETED' && status !== 'SUCCESS') {
                logger.debug(`[SettlementCron] INA order ${o.id} status=${status}, waiting for PAID`)
                return
              }

              // Parse settlement time
              const paidAt = data.paid_at || data.paidAt || data.payment_received_time
              const settlementTmt = paidAt ? new Date(paidAt) : undefined

              settlementResult = {
                netAmt: o.pendingAmount ?? data.amount ?? data.total ?? 0,
                rrn: resp.reff || pgRefId || 'N/A',
                st: 'COMPLETED',
                tmt: settlementTmt
              }
            } catch (inaErr: any) {
              logger.error(`[SettlementCron] INA check failed for order ${o.id}:`, inaErr.message)
              return // Skip this order
            }
          }

          if (!settlementResult) return

          const key = o.partnerClientId!
          const arr = groups.get(key) ?? []
          arr.push({ order: o, settlement: settlementResult })
          groups.set(key, arr)
        } catch (err) {
          logger.error(`[SettlementCron] order ${o.id} failed:`, err)
        }
      })
    )
  )

  const dbLimit = pLimit(DB_CONCURRENCY)
  const txPromises = Array.from(groups.entries()).map(([pcId, items]) =>
    dbLimit(async () => {
      let settledCount = 0
      let netAmount = 0
      const chunks = chunk(items, PARTNER_TX_CHUNK_SIZE)
      for (const chunkItems of chunks) {
        try {
          const res = await retryTx(
            () =>
              prisma.$transaction(async tx => {
                let sc = 0
                let na = 0
                for (const { order, settlement } of chunkItems) {
                  const upd = await tx.order.updateMany({
                    where: { id: order.id, status: { in: INPUT_SETTLEMENT_STATUSES } },
                    data: {
                      status: 'SETTLED',
                      settlementAmount: settlement.netAmt,
                      pendingAmount: null,
                      ...(settlement.fee && { fee3rdParty: settlement.fee }),
                      rrn: settlement.rrn,
                      settlementStatus: settlement.st,
                      settlementTime: settlement.tmt,
                      updatedAt: new Date()
                    }
                  })
                  if (upd.count > 0) {
                    sc++
                    na += settlement.netAmt
                  }
                }
                if (na > 0) {
                  await tx.partnerClient.update({
                    where: { id: pcId },
                    data: { balance: { increment: na } }
                  })
                }
                return { settledCount: sc, netAmount: na }
              }, { timeout: DB_TX_TIMEOUT_MS })
          )
          settledCount += res.settledCount
          netAmount += res.netAmount
        } catch (err) {
          logger.error(`[SettlementCron] partnerClient ${pcId} failed:`, err)
        }
      }
      return { settledCount, netAmount }
    })
  )

  const settled = await Promise.allSettled(txPromises)
  let settledCount = 0
  let netAmount = 0
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      settledCount += r.value.settledCount
      netAmount += r.value.netAmount
    }
  }

  const hasMore = pendingOrders.length === BATCH_SIZE
  return { hasMore, settledCount, netAmount, lastCursor }
}

// ————————— SCHEDULER —————————
let cutoffTime: Date | null = null
let settlementTask: ScheduledTask | null = null
let settlementCronExpr = '0 16 * * *'

function validateExpr(expr: string) {
  const parts = expr.trim().split(/\s+/)
  // dukung 5 atau 6 field (beberapa versi node-cron pakai detik)
  if (!cron.validate(expr) || (parts.length !== 5 && parts.length !== 6)) {
    throw new Error(`Invalid cron expr: "${expr}"`)
  }
}

async function runSettlementJob() {
  try {
    cutoffTime = new Date()
    logger.info('[SettlementCron] 🔄 Set cut-off at ' + cutoffTime.toISOString())
    try {
      await sendTelegramMessage(
        config.api.telegram.adminChannel,
        `[SettlementCron] Starting settlement check at ${cutoffTime.toISOString()}`
      )
    } catch (err) {
      logger.error('[SettlementCron] Failed to send Telegram notification:', err)
    }

    let settledOrders = 0
    let netAmount = 0
    let ranIterations = 0

    if (WORKER_CONCURRENCY <= 1) {
      // sequential mode
      let cursor: Cursor = null
      while (true) {
        const { settledCount, netAmount: na, lastCursor, hasMore } = await processBatch(cursor)
        if (!settledCount) break
        settledOrders += settledCount
        netAmount += na
        ranIterations++
        cursor = lastCursor
        logger.info(`[SettlementCron] Iter ${ranIterations}: settled ${settledCount}`)
        if (!hasMore) break
        await new Promise(r => setTimeout(r, 500))
      }
    } else {
      // concurrent mode
      const cursors: Cursor[] = []
      let cursor: Cursor = null
      while (true) {
        const rows = await prisma.order.findMany({
          where: {
            status: { in: INPUT_SETTLEMENT_STATUSES },
            partnerClientId: { not: null },
            ...(cutoffTime && { createdAt: { lte: cutoffTime } }),
            ...(cursor
              ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }
              : {})
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: BATCH_SIZE,
          select: { id: true, createdAt: true }
        })
        if (!rows.length) break
        cursors.push(cursor)
        const last = rows[rows.length - 1]
        cursor = { createdAt: last.createdAt, id: last.id }
      }

      const limit = pLimit(WORKER_CONCURRENCY)
      const results = await Promise.all(cursors.map(c => limit(() => processBatch(c))))
      ranIterations = results.length
      for (const r of results) {
        settledOrders += r.settledCount
        netAmount += r.netAmount
      }
    }

    try {
      await sendTelegramMessage(
        config.api.telegram.adminChannel,
        `[SettlementCron] Summary: iterations ${ranIterations}, settled ${settledOrders} orders, net amount ${netAmount}`
      )
    } catch (err) {
      logger.error('[SettlementCron] Failed to send Telegram summary:', err)
    }
  } catch (err) {
    logger.error('[SettlementCron] Unexpected error:', err)
    try {
      if (config.api.telegram.adminChannel) {
        await sendTelegramMessage(
          config.api.telegram.adminChannel,
          `[SettlementCron] Fatal error: ${err instanceof Error ? err.message : err}`
        )
      }
    } catch (telegramErr) {
      logger.error('[SettlementCron] Failed to send Telegram alert:', telegramErr)
    }
  }
}

function createTask(expr: string) {
  validateExpr(expr)
  const task = cron.schedule(expr, runSettlementJob, { timezone: TZ })
  logger.info(`[SettlementCron] ✅ scheduled "${expr}" (${TZ})`)
  return task
}

export async function scheduleSettlementChecker() {
  process.on('SIGINT', () => logger.info('[SettlementCron] SIGINT, shutdown…'))
  process.on('SIGTERM', () => logger.info('[SettlementCron] SIGTERM, shutdown…'))

  logger.info('[SettlementCron] ⏳ Bootstrapping from DB…')
  const setting = await prisma.setting.findUnique({ where: { key: 'settlement_cron' } })
  const expr = (setting?.value || '0 16 * * *').trim()

  // stop kalau ada task lama
  settlementTask?.stop()
  settlementTask?.destroy()
  settlementTask = null

  settlementCronExpr = expr
  settlementTask = createTask(expr)
}

export function restartSettlementChecker(expr: string) {
  const finalExpr = (expr || settlementCronExpr || '0 16 * * *').trim()
  // stop task lama
  if (settlementTask) {
    try { settlementTask.stop() } catch {}
    try { settlementTask.destroy() } catch {}
    settlementTask = null
  }
  settlementCronExpr = finalExpr
  settlementTask = createTask(finalExpr)
  logger.info(`[SettlementCron] 🔁 restarted with "${finalExpr}"`)
}

export function resetSettlementState() {
  if (settlementTask) {
    try { settlementTask.stop() } catch {}
    try { settlementTask.destroy() } catch {}
  }
  settlementTask = null
  cutoffTime = null
  logger.info('[SettlementCron] state reset')
}

// ✅ dipakai di /ops/cron-status
export function getSettlementCronStatus() {
  return { running: !!settlementTask, expr: settlementCronExpr || null, timezone: TZ }
}

// ————————— MANUAL RUN —————————
export async function runManualSettlement(
  onProgress?: (p: { settledOrders: number; netAmount: number; batchSettled: number; batchAmount: number }) => void
) {
  cutoffTime = new Date()

  let settledOrders = 0
  let netAmount = 0
  let cursor: Cursor = null

  while (true) {
    const { settledCount, netAmount: na, lastCursor } = await processBatch(cursor)
    if (!settledCount) break
    settledOrders += settledCount
    netAmount += na
    cursor = lastCursor
    onProgress?.({ settledOrders, netAmount, batchSettled: settledCount, batchAmount: na })
  }

  return { settledOrders, netAmount }
}
