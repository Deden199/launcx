import { Request, Response } from 'express'
import { prisma } from '../core/prisma'
import { retryDisbursement } from '../service/hilogate.service'
import { ClientAuthRequest } from '../middleware/clientAuth'
import { ApiKeyRequest } from '../middleware/apiKeyAuth'
import { HilogateClient,HilogateConfig } from '../service/hilogateClient'
import { GidiClient, GidiDisbursementConfig, GidiError } from '../service/gidiClient'
import { Ing1Client, Ing1Config } from '../service/ing1Client'
import crypto from 'crypto'
import { config } from '../config'
import logger from '../logger'
import { DisbursementStatus, Prisma } from '@prisma/client'
import { getActiveProviders } from '../service/provider';
import {OyClient,OyConfig}          from '../service/oyClient'    // sesuaikan path
import { PiroClient, PiroConfig } from '../service/piroClient'
import { GenesisClient } from '../service/genesisClient'
import { authenticator } from 'otplib'
import { parseDateSafely } from '../util/time'
import { mapIng1Status, parseIng1Date, parseIng1Number } from '../service/ing1Status'
import { ObjectId } from 'mongodb'

const mapIng1ToDisbursement = (
  rc?: number | null,
  statusText?: string | null
): DisbursementStatus => {
  const normalized = mapIng1Status(rc ?? null, statusText ?? null)
  if (normalized === 'PAID') return DisbursementStatus.COMPLETED
  if (normalized === 'PENDING') return DisbursementStatus.PENDING
  return DisbursementStatus.FAILED
}

const mapPiroDisbursement = (status: string | null | undefined): DisbursementStatus => {
  const up = (status ?? '').toUpperCase()
  if (['SUCCESS', 'COMPLETED', 'PAID', 'DONE', 'SETTLED'].includes(up)) {
    return DisbursementStatus.COMPLETED
  }
  if (['FAILED', 'REJECTED', 'ERROR', 'CANCELLED', 'CANCELED', 'VOID'].includes(up)) {
    return DisbursementStatus.FAILED
  }
  return DisbursementStatus.PENDING
}

const PIRO_VARIANTS = ['piro', 'genesis'] as const
const isPiroVariant = (provider?: string | null): provider is 'piro' | 'genesis' =>
  provider === 'piro' || provider === 'genesis'


// Helper untuk nyamain bentuk ID dari aggregateRaw & Prisma
const normalizeMongoId = (raw: any): string => {
  if (!raw) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object') {
    // Prisma + Mongo biasanya bentuknya { $oid: '...' }
    if ('$oid' in raw) return (raw as any).$oid
    // kalau _id nested atau bentuk lain, fallback ke JSON
    return String((raw as any)._id ?? raw)
  }
  return String(raw)
}

const maybeObjectId = (id: string): string | ObjectId => {
  if (typeof id !== 'string') return id as any
  if (/^[0-9a-fA-F]{24}$/.test(id)) {
    return new ObjectId(id)
  }
  return id
}


// src/controllers/withdraw.controller.ts
// CRITICAL FIX: Balance calculation untuk listSubMerchants

// export const listSubMerchants = async (req: ClientAuthRequest, res: Response) => {
//   const clientUserId = req.clientUserId!

//   // 1) Ambil partnerClientId + defaultProvider dari user
//   const userWithDp = await prisma.clientUser.findUnique({
//     where: { id: clientUserId },
//     select: {
//       partnerClientId: true,
//       partnerClient: {
//         select: { defaultProvider: true }
//       }
//     }
//   })
//   if (!userWithDp) return res.status(404).json({ error: 'User tidak ditemukan' })

//   const { partnerClientId } = userWithDp
//   const defaultProvider = userWithDp.partnerClient.defaultProvider
//   if (!defaultProvider) return res.status(400).json({ error: 'defaultProvider tidak diset' })

//   const { clientId: qClientId } = req.query
//   const clientIds = typeof qClientId === 'string' && qClientId !== 'all'
//     ? [qClientId]
//     : [partnerClientId, ...(req.childrenIds ?? [])]

//   // Build cache key
//   const cacheKey = `submerchants:${partnerClientId}:${qClientId || 'all'}:${defaultProvider}`

//   try {
//     const { cacheWrapper } = await import('../core/redis')
//     const result = await cacheWrapper(cacheKey, 'submerchants', async () => {
//       // 2) Ambil semua sub_merchant dengan provider matching defaultProvider
//       const subs = await prisma.sub_merchant.findMany({
//         where: { provider: defaultProvider },
//         select: { id: true, name: true, provider: true }
//       })

//       if (subs.length === 0) {
//         return []
//       }

//       const subIds = subs.map(s => s.id)

//       // ✅ FIX: Use aggregateRaw with CONSISTENT settlementTime logic
//       const [inAggs, outAggs] = await Promise.all([
//         // Settlement IN: Orders dengan settlementTime NOT NULL atau status SUCCESS/DONE/SETTLED
//         prisma.order.aggregateRaw({
//           pipeline: [
//             {
//               $match: {
//                 subMerchantId: { $in: subIds },
//                 partnerClientId: { $in: clientIds },
//                 $or: [
//                   // Prioritas 1: Ada settlementTime
//                   { settlementTime: { $ne: null } },
//                   // Prioritas 2: Status SUCCESS/DONE/SETTLED (untuk data lama yang settlementTime null)
//                   { 
//                     status: { 
//                       $in: ['SUCCESS', 'DONE', 'SETTLED'] 
//                     }
//                   }
//                 ]
//               }
//             },
//             {
//               $group: {
//                 _id: '$subMerchantId',
//                 total: { $sum: '$settlementAmount' }
//               }
//             }
//           ]
//         }),
//         // Withdrawal OUT: Pending + Completed withdrawals
//         prisma.withdrawRequest.aggregateRaw({
//           pipeline: [
//             {
//               $match: {
//                 subMerchantId: { $in: subIds },
//                 partnerClientId: { $in: clientIds },
//                 status: { $in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] }
//               }
//             },
//             {
//               $group: {
//                 _id: '$subMerchantId',
//                 total: { $sum: '$amount' }
//               }
//             }
//           ]
//         })
//       ])

//       // 4) Parse aggregateRaw results and create lookup maps
//       const inResults = (inAggs as any) || []
//       const outResults = (outAggs as any) || []

//       const inMap = new Map(
//         (Array.isArray(inResults) ? inResults : []).map((agg: any) => [
//           String(agg._id),
//           Number(agg.total) || 0
//         ])
//       )

//       const outMap = new Map(
//         (Array.isArray(outResults) ? outResults : []).map((agg: any) => [
//           String(agg._id),
//           Number(agg.total) || 0
//         ])
//       )

//       // 5) Build result
//       return subs.map(s => ({
//         id: s.id,
//         name: s.name,
//         provider: s.provider,
//         balance: (inMap.get(s.id) ?? 0) - (outMap.get(s.id) ?? 0)
//       }))
//     })

//     return res.json(result)
//   } catch (err: any) {
//     logger.error('[listSubMerchants]', err)
//     return res.status(500).json({ error: err.message || 'Internal server error' })
//   }
// }
export const listSubMerchants = async (req: ClientAuthRequest, res: Response) => {
  const clientUserId = req.clientUserId!

  logger.info(`[listSubMerchants] start, clientUserId=${clientUserId}`)

  // 1) Ambil partnerClientId + defaultProvider dari user
  const userWithDp = await prisma.clientUser.findUnique({
    where: { id: clientUserId },
    select: {
      partnerClientId: true,
      partnerClient: {
        select: { defaultProvider: true }
      }
    }
  })

  logger.info(
    `[listSubMerchants] userWithDp=${JSON.stringify(userWithDp)}`
  )

  if (!userWithDp) {
    logger.warn(
      `[listSubMerchants] user tidak ditemukan, clientUserId=${clientUserId}`
    )
    return res.status(404).json({ error: 'User tidak ditemukan' })
  }

  const { partnerClientId } = userWithDp
  const defaultProvider = userWithDp.partnerClient?.defaultProvider

  if (!defaultProvider) {
    logger.warn(
      `[listSubMerchants] defaultProvider tidak diset, partnerClientId=${partnerClientId}`
    )
    return res.status(400).json({ error: 'defaultProvider tidak diset' })
  }

  const { clientId: qClientId } = req.query as { clientId?: string }
  const clientIds = typeof qClientId === 'string' && qClientId !== 'all'
    ? [qClientId]
    : [partnerClientId, ...(req.childrenIds ?? [])]

  logger.info(
    `[listSubMerchants] context partnerClientId=${partnerClientId}, defaultProvider=${defaultProvider}, qClientId=${qClientId}, clientIds=${JSON.stringify(clientIds)}`
  )

  // Build cache key
  const cacheKey = `submerchants:${partnerClientId}:${qClientId || 'all'}:${defaultProvider}`
  logger.info(`[listSubMerchants] cacheKey=${cacheKey}`)

  try {
    const { cacheWrapper } = await import('../core/redis')

    const result = await cacheWrapper(cacheKey, 'submerchants', async () => {
      logger.info(
        `[listSubMerchants] cache MISS, querying DB for provider=${defaultProvider}`
      )

      // 2) Ambil semua sub_merchant dengan provider matching defaultProvider
      const subs = await prisma.sub_merchant.findMany({
        where: { provider: defaultProvider },
        select: { id: true, name: true, provider: true }
      })

      logger.info(
        `[listSubMerchants] found ${subs.length} sub_merchants for provider=${defaultProvider}`
      )
      logger.info(
        `[listSubMerchants] subs preview=${JSON.stringify(subs.map(s => ({ id: s.id, name: s.name })).slice(0, 5))}`
      )

      if (subs.length === 0) {
        return []
      }

      const subIds = subs.map(s => s.id)
      logger.info(
        `[listSubMerchants] subIds=${JSON.stringify(subIds)}`
      )

      // 3) Ambil orders (IN) & withdrawals (OUT) pakai Prisma biasa
      const [orders, withdraws] = await Promise.all([
        prisma.order.findMany({
          where: {
            subMerchantId: { in: subIds },
            partnerClientId: { in: clientIds },
            OR: [
              { settlementTime: { not: null } },
              { status: { in: ['SUCCESS', 'DONE', 'SETTLED'] } }
            ]
          },
          select: {
            subMerchantId: true,
            settlementAmount: true
          }
        }),
        prisma.withdrawRequest.findMany({
          where: {
            subMerchantId: { in: subIds },
            partnerClientId: { in: clientIds },
            status: {
              in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED]
            }
          },
          select: {
            subMerchantId: true,
            amount: true
          }
        })
      ])

      logger.info(
        `[listSubMerchants] orders count=${orders.length}, withdraws count=${withdraws.length}`
      )

      if (process.env.NODE_ENV !== 'production') {
        logger.info(
          `[listSubMerchants] orders sample=${JSON.stringify(orders.slice(0, 3))}`
        )
        logger.info(
          `[listSubMerchants] withdraws sample=${JSON.stringify(withdraws.slice(0, 3))}`
        )
      }

      // 4) Group & sum di memory
      const inMap = new Map<string, number>()
      for (const o of orders) {
        const key = o.subMerchantId
        const amt = Number(o.settlementAmount ?? 0)
        inMap.set(key, (inMap.get(key) ?? 0) + amt)
      }

      const outMap = new Map<string, number>()
      for (const w of withdraws) {
        const key = w.subMerchantId
        const amt = Number(w.amount ?? 0)
        outMap.set(key, (outMap.get(key) ?? 0) + amt)
      }

      logger.info(
        `[listSubMerchants] inMap keys=${JSON.stringify(Array.from(inMap.keys()))}`
      )
      logger.info(
        `[listSubMerchants] outMap keys=${JSON.stringify(Array.from(outMap.keys()))}`
      )

      // 5) Build result untuk masing-masing sub_merchant
      const finalResult = subs.map(s => {
        const totalIn = inMap.get(s.id) ?? 0
        const totalOut = outMap.get(s.id) ?? 0
        const balance = totalIn - totalOut

        logger.info(
          `[listSubMerchants] sub=${s.name}(${s.id}) totalIn=${totalIn} totalOut=${totalOut} balance=${balance}`
        )

        return {
          id: s.id,
          name: s.name,
          provider: s.provider,
          balance
        }
      })

      logger.info(
        `[listSubMerchants] finalResult count=${finalResult.length}, preview=${JSON.stringify(finalResult.slice(0, 5))}`
      )

      return finalResult
    })

    logger.info(
      `[listSubMerchants] done, returning ${Array.isArray(result) ? result.length : -1} sub_merchants for clientUserId=${clientUserId}`
    )

    return res.json(result)
  } catch (err: any) {
    logger.error(
      `[listSubMerchants] ERROR: ${err?.message} stack=${err?.stack}`
    )
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}


// ✅ CRITICAL: Add this function to fix existing data
export async function migrateSettlementTime(req: Request, res: Response) {
  try {
    // Fix orders dengan status SUCCESS/DONE/SETTLED tapi settlementTime null
    const result = await prisma.order.updateMany({
      where: {
        status: { in: ['SUCCESS', 'DONE', 'SETTLED'] },
        settlementTime: null,
        paymentReceivedTime: { not: null } // Gunakan paymentReceivedTime sebagai fallback
      },
      data: {
        settlementTime: new Date() // Atau bisa pakai: paymentReceivedTime
      }
    })

    // Alternative: Use paymentReceivedTime as settlementTime
    const ordersToFix = await prisma.order.findMany({
      where: {
        status: { in: ['SUCCESS', 'DONE', 'SETTLED'] },
        settlementTime: null,
        paymentReceivedTime: { not: null }
      },
      select: { id: true, paymentReceivedTime: true }
    })

    // Update satu per satu dengan paymentReceivedTime
    for (const order of ordersToFix) {
      await prisma.order.update({
        where: { id: order.id },
        data: { settlementTime: order.paymentReceivedTime }
      })
    }

    return res.json({
      success: true,
      updatedCount: result.count,
      fixedWithPaymentTime: ordersToFix.length,
      message: 'Settlement time migration completed'
    })
  } catch (err: any) {
    logger.error('[migrateSettlementTime]', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function listWithdrawals(req: ClientAuthRequest, res: Response) {
  // Build cache key from query params
  const {
    clientId: qClientId,
    status,
    date_from,
    date_to,
    ref,
    page = '1',
    limit = '20',
  } = req.query;

  const cacheKey = `withdrawals:${req.clientUserId}:${qClientId || 'all'}:${status || ''}:${date_from || ''}:${date_to || ''}:${ref || ''}:${page}:${limit}`;

  try {
    // Use Redis caching with 30 second TTL
    const { cacheWrapper } = await import('../core/redis');
    const result = await cacheWrapper(cacheKey, 'withdrawals', async () => {
      // 1) Ambil partnerClientId + daftarnya children
      const user = await prisma.clientUser.findUnique({
        where: { id: req.clientUserId! },
        select: {
          partnerClientId: true,
          partnerClient: {
            select: {
              children: { select: { id: true } }
            }
          }
        }
      });
      if (!user) {
        throw new Error('User tidak ditemukan');
      }

      const parentId = user.partnerClientId;
      const childIds = user.partnerClient?.children.map(c => c.id) ?? [];

      const fromDate = parseDateSafely(date_from);
      const toDate   = parseDateSafely(date_to);
      let clientIds: string[];
      if (typeof qClientId === 'string' && qClientId !== 'all') {
        clientIds = [qClientId];
      } else {
        clientIds = [parentId, ...childIds];
      }

      // 3) Build filter
      const where: any = {
        partnerClientId: { in: clientIds }
      };
      if (status) where.status = status as string;
      if (ref)    where.refId = { contains: ref as string, mode: 'insensitive' };
      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) where.createdAt.gte = fromDate;
        if (toDate)   where.createdAt.lte = toDate;
      }

      // 4) Pagination
      const pageNum  = Math.max(1, parseInt(page as string, 10));
      const pageSize = Math.min(100, parseInt(limit as string, 10));

      // 5) Query - OPTIMIZED: Only select fields we need
      const [rows, total] = await Promise.all([
        prisma.withdrawRequest.findMany({
          where,
          skip:  (pageNum - 1) * pageSize,
          take:  pageSize,
          orderBy: { createdAt: 'desc' },
          select: {
            refId:         true,
            bankName:      true,
            accountName:   true,
            accountNumber: true,
            amount:        true,
            netAmount:     true,
            pgFee:         true,
            withdrawFeePercent: true,
            withdrawFeeFlat:    true,
            status:        true,
            createdAt:     true,
            completedAt:   true,
            sourceProvider: true,
            subMerchant: { select: { name: true, provider: true } },
          },
        }),
        prisma.withdrawRequest.count({ where }),
      ]);

      // 6) Format
      const data = rows.map(w => ({
        refId:         w.refId,
        bankName:      w.bankName,
        accountName:   w.accountName,
        accountNumber: w.accountNumber,
        amount:        w.amount,
        netAmount:     w.netAmount,
        pgFee:         w.pgFee ?? null,
        withdrawFeePercent: w.withdrawFeePercent,
        withdrawFeeFlat:    w.withdrawFeeFlat,
        status:        w.status,
        createdAt:     w.createdAt.toISOString(),
        completedAt:   w.completedAt?.toISOString() ?? null,
        wallet:
          w.sourceProvider === 'manual'
            ? 'Manual Entry'
            : w.subMerchant?.name ?? w.subMerchant?.provider ?? null,
        sourceProvider: w.sourceProvider,
      }));

      return { data, total };
    });

    return res.json(result);
  } catch (err: any) {
    if (err.message === 'User tidak ditemukan') {
      return res.status(404).json({ error: err.message });
    }
    logger.error('[listWithdrawals]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

export async function listWithdrawalsS2S(req: ApiKeyRequest, res: Response) {
  const parentId = req.clientId!
  const childIds = req.childrenIds ?? []

  const {
    clientId: qClientId,
    status,
    date_from,
    date_to,
    ref,
    page = '1',
    limit = '20',
  } = req.query
  const fromDate = parseDateSafely(date_from)
  const toDate = parseDateSafely(date_to)
  let clientIds: string[]
  if (typeof qClientId === 'string' && qClientId !== 'all') {
    clientIds = [qClientId]
  } else {
    clientIds = [parentId, ...childIds]
  }

  const where: any = {
    partnerClientId: { in: clientIds },
  }
  if (status) where.status = status as string
  if (ref) where.refId = { contains: ref as string, mode: 'insensitive' }
  if (fromDate || toDate) {
    where.createdAt = {}
    if (fromDate) where.createdAt.gte = fromDate
    if (toDate) where.createdAt.lte = toDate
  }

  const pageNum = Math.max(1, parseInt(page as string, 10))
  const pageSize = Math.min(100, parseInt(limit as string, 10))
  const [rows, total] = await Promise.all([
    prisma.withdrawRequest.findMany({
      where,
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        refId: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        amount: true,
        netAmount: true,
        pgFee: true,
        withdrawFeePercent: true,
        withdrawFeeFlat: true,
        status: true,
        createdAt: true,
        completedAt: true,
        subMerchant: { select: { name: true, provider: true } },
      },
    }),
    prisma.withdrawRequest.count({ where }),
  ])

  const data = rows.map(w => ({
    refId: w.refId,
    bankName: w.bankName,
    accountName: w.accountName,
    accountNumber: w.accountNumber,
    amount: w.amount,
    netAmount: w.netAmount,
    pgFee: w.pgFee ?? null,
    withdrawFeePercent: w.withdrawFeePercent,
    withdrawFeeFlat: w.withdrawFeeFlat,
    status: w.status,
    createdAt: w.createdAt.toISOString(),
    completedAt: w.completedAt?.toISOString() ?? null,
    wallet: w.subMerchant?.name ?? w.subMerchant?.provider ?? null,
  }))

  return res.json({ data, total })
}

// POST /api/v1/withdrawals/:id/retry
export async function retryWithdrawal(req: Request, res: Response) {
  // clientId di-attach oleh middleware ClientAuthRequest, tapi di sini kita pakai req.client.id
  const clientId = (req as any).client.id as string;
  const { id }   = req.params;

  // 1) Ownership check
  const wr = await prisma.withdrawRequest.findUnique({
    where: { refId: id },
    select: { refId: true, status: true, partnerClientId: true }
  });
  if (!wr || wr.partnerClientId !== clientId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // 2) Status guard
  if (['SUCCESS', 'PROCESSING'].includes(wr.status)) {
    return res
      .status(400)
      .json({ error: `Tidak dapat retry untuk status ${wr.status}` });
  }

  // 3) Retry process with merchantId
  try {
    const result = await retryDisbursement(wr.refId, wr.partnerClientId);
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('Retry withdrawal error:', err);
    return res
      .status(500)
      .json({ error: 'Gagal melakukan retry. Silakan coba lagi nanti.' });
  }
}
async function retry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastError: any
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (e: any) {
      lastError = e
      if (e.message?.includes('write conflict') || e.code === 'P2034') {
        await new Promise(r => setTimeout(r, 50 * (i + 1)))
        continue
      }
      throw e
    }
  }
  throw lastError
}

// Query all pending Gidi withdrawals and refresh their status via GIDI API
export async function queryPendingGidiWithdrawals(req: Request, res: Response) {
  try {
    const pendings = await prisma.withdrawRequest.findMany({
      where: { sourceProvider: 'gidi', status: DisbursementStatus.PENDING },
      select: {
        refId: true,
        partnerClientId: true,
        amount: true,
        subMerchant: { select: { credentials: true } },
      },
    })

    const results: { refId: string; status: DisbursementStatus }[] = []

    for (const w of pendings) {
      try {
        const cfg = w.subMerchant.credentials as unknown as GidiDisbursementConfig
        const client = new GidiClient(cfg)
        const resp = await client.queryTransfer(`${w.refId}-r`, w.refId)
        const st = String(resp.statusTransfer || '').toLowerCase()
        const newStatus =
          st === 'success'
            ? DisbursementStatus.COMPLETED
            : st === 'failed'
              ? DisbursementStatus.FAILED
              : DisbursementStatus.PENDING

        if (newStatus !== DisbursementStatus.PENDING) {
          await prisma.withdrawRequest.update({
            where: { refId: w.refId },
            data: { status: newStatus },
          })
          if (newStatus === DisbursementStatus.FAILED) {
            await prisma.partnerClient.update({
              where: { id: w.partnerClientId },
              data: { balance: { increment: w.amount } },
            })
          }
        }

        results.push({ refId: w.refId, status: newStatus })
      } catch (err) {
        logger.error('[queryPendingGidiWithdrawals] error', { refId: w.refId, err })
      }
    }

    return res.json({ processed: results.length, results })
  } catch (err: any) {
    logger.error('[queryPendingGidiWithdrawals] fatal', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function queryPendingIng1Withdrawals(req: Request, res: Response) {
  try {
    const pendings = await prisma.withdrawRequest.findMany({
      where: { sourceProvider: 'ing1', status: DisbursementStatus.PENDING },
      select: {
        refId: true,
        partnerClientId: true,
        amount: true,
        paymentGatewayId: true,
        subMerchant: { select: { credentials: true } },
      },
    })

    const results: { refId: string; status: DisbursementStatus }[] = []

    for (const w of pendings) {
      try {
        const rawCfg = w.subMerchant?.credentials as unknown as Ing1Config
        const cfg: Ing1Config = {
          baseUrl: rawCfg.baseUrl,
          email: rawCfg.email,
          password: rawCfg.password,
          productCode: rawCfg.productCode,
          callbackUrl: rawCfg.callbackUrl,
          permanentToken: rawCfg.permanentToken,
          merchantId: rawCfg.merchantId,
          apiVersion: rawCfg.apiVersion,
        }

        const client = new Ing1Client(cfg)
        const history = await client.listCashoutHistory({
          reff: w.paymentGatewayId ?? undefined,
          clientReff: w.refId,
        })

        const match = history.histories.find((item) => {
          if (w.paymentGatewayId && item.reff) {
            return item.reff === w.paymentGatewayId
          }
          return item.clientReff === w.refId
        })

        const statusCandidate = match?.status ?? (history.raw?.status as string | undefined)
        const newStatus = mapIng1ToDisbursement(history.rc, statusCandidate ?? null)

        if (newStatus !== DisbursementStatus.PENDING) {
          const updateData: any = {
            status: newStatus,
          }

          if (match?.reff) {
            updateData.paymentGatewayId = match.reff
          }

          if (match?.paidAt) {
            const paidAt = parseIng1Date(match.paidAt)
            if (paidAt) updateData.completedAt = paidAt
          }

          const feeCandidate =
            typeof match?.fee === 'number' ? match.fee : parseIng1Number(match?.fee ?? null)
          if (feeCandidate != null) {
            updateData.pgFee = feeCandidate
          }

          await prisma.withdrawRequest.update({
            where: { refId: w.refId },
            data: updateData,
          })

          if (newStatus === DisbursementStatus.FAILED) {
            await prisma.partnerClient.update({
              where: { id: w.partnerClientId },
              data: { balance: { increment: w.amount } },
            })
          }
        }

        results.push({ refId: w.refId, status: newStatus })
      } catch (err) {
        logger.error('[queryPendingIng1Withdrawals] error', { refId: w.refId, err })
      }
    }

    return res.json({ processed: results.length, results })
  } catch (err: any) {
    logger.error('[queryPendingIng1Withdrawals] fatal', err)
    return res.status(500).json({ error: err.message })
  }
}

export const withdrawalCallback = async (req: Request, res: Response) => {
  try {
    // 1) Ambil & parse raw body
    // @ts-ignore
    const raw = (req.rawBody as Buffer).toString('utf8')
    const full = JSON.parse(raw) as any

    // 2) Verifikasi signature
    const gotSig = (req.header('X-Signature') || '').trim()
    if (full.merchant_signature && gotSig !== full.merchant_signature) {
      return res.status(400).json({ error: 'Invalid signature' })
    }

    // 3) Ambil payload
    const data = full.data ?? full

    // Deteksi format OY atau Hilogate
    const isOy =
      typeof data.status === 'object' &&
      data.status !== null &&
      'code' in data.status

    const refId = isOy ? data.partner_trx_id : data.ref_id
    if (!refId) {
      return res.status(400).json({ error: 'Invalid payload' })
    }

    // 4) Fetch withdrawal record
    const wr = await prisma.withdrawRequest.findUnique({
      where: { refId },
      select: { amount: true, partnerClientId: true, status: true }
    })
    let adminW: { status: DisbursementStatus } | null = null
    let isAdmin = false
    if (!wr) {
      adminW = await prisma.adminWithdraw.findUnique({
        where: { refId },
        select: { status: true }
      })
      if (!adminW) return res.status(404).send('Not found')
      isAdmin = true
    }
    const oldStatus = wr ? wr.status : adminW!.status
    // 5) Tentukan newStatus + completedAt
    let newStatus: DisbursementStatus
    let completedAt: Date | undefined

    if (isOy) {
      const code = String(data.status.code)
      newStatus =
        code === '000'
          ? DisbursementStatus.COMPLETED
          : code === '300'
            ? DisbursementStatus.FAILED
            : DisbursementStatus.PENDING
      completedAt = parseDateSafely(data.last_updated_date)

    } else {
      const up = String(data.status).toUpperCase()
      newStatus =
        up === 'COMPLETED' || up === 'SUCCESS'
          ? DisbursementStatus.COMPLETED
          : up === 'FAILED' || up === 'ERROR'
            ? DisbursementStatus.FAILED
            : DisbursementStatus.PENDING
      completedAt = parseDateSafely(data.completed_at)
    }

        // 6) Idempotent update +retry
        
    const updateData: any = { status: newStatus }
    const feeRaw =
      typeof data.total_fee === 'number'
        ? data.total_fee
        : typeof data.fee === 'number'
          ? data.fee
          : typeof data.transfer_fee === 'number'
            ? data.transfer_fee
            : typeof data.admin_fee?.total_fee === 'number'
              ? data.admin_fee.total_fee
              : null
    if (feeRaw != null) {
      updateData.pgFee = feeRaw
    }
        if (data.trx_id || data.trxId) {
      updateData.pgRefId = data.trx_id || data.trxId
    }
    if (completedAt) {
      updateData.completedAt = completedAt
    } else if (data.last_updated_date) {
      logger.warn(`Failed to parse last_updated_date: ${data.last_updated_date}`)
    }

    const updateResult = await retry(() =>
      (isAdmin
        ? prisma.adminWithdraw.updateMany({
            where: {
              refId,
              status: { in: [DisbursementStatus.PENDING, DisbursementStatus.FAILED] },
            },
            data: updateData,
          })
        : prisma.withdrawRequest.updateMany({
            where: {
              refId,
              status: { in: [DisbursementStatus.PENDING, DisbursementStatus.FAILED] },
            },
            data: updateData,

          }))
    )
    const count = (updateResult as { count?: number }).count ?? 0

    // 7) Balance adjustments based on status transition
    if (!isAdmin && count > 0 && oldStatus !== newStatus) {
      if (oldStatus === DisbursementStatus.FAILED && newStatus === DisbursementStatus.COMPLETED) {
        await retry(() =>
          prisma.partnerClient.update({
            where: { id: wr!.partnerClientId },
            data: { balance: { decrement: wr!.amount } },
          })
        )
      } else if (oldStatus === DisbursementStatus.PENDING && newStatus === DisbursementStatus.FAILED) {
        await retry(() =>
          prisma.partnerClient.update({
            where: { id: wr!.partnerClientId },
            data: { balance: { increment: wr!.amount } },
          })
        )
      }

      // Invalidate caches after status change
      const { cacheDelPattern } = await import('../core/redis')
      await Promise.all([
        cacheDelPattern(`withdrawals:*`),
        cacheDelPattern(`submerchants:*`),
        cacheDelPattern(`dashboard:*`)
      ]).catch(err => logger.error('[withdrawalCallback] Cache invalidation failed:', err))
    }

    return res.status(200).json({ message: 'OK' })
  } catch (err: any) {
    console.error('[withdrawalCallback] error:', err)
    return res.status(500).json({ error: err.message })
  }
}

export const piroWithdrawalCallback = async (req: Request, res: Response) => {
  try {
    const raw = (() => {
      const buf = (req as any).rawBody
      if (typeof buf === 'string') return buf
      if (Buffer.isBuffer(buf)) return buf.toString('utf8')
      return JSON.stringify(req.body ?? {})
    })()

    const signature = (req.header('x-piro-signature') || req.header('X-Piro-Signature') || '').trim()
    if (!signature) {
      return res.status(400).json({ error: 'Missing signature' })
    }

    let body: any
    try {
      body = JSON.parse(raw || '{}')
    } catch (err) {
      return res.status(400).json({ error: 'Invalid JSON payload' })
    }

    let expected: string
    if (config.api.genesis.enabled) {
      const secret = config.api.genesis.secret || config.api.piro.signatureKey
      if (!secret) {
        return res.status(400).json({ error: 'Missing Genesis signature secret' })
      }
      const clientId =
        body.clientId || body.client_id || body.data?.clientId || body.data?.client_id || ''
      if (!clientId) {
        return res.status(400).json({ error: 'Missing Genesis client ID' })
      }
      expected = GenesisClient.callbackSignature(body.data ?? body, secret, clientId)
    } else {
      const signatureKey = config.api.piro.signatureKey
      if (!signatureKey) {
        return res.status(400).json({ error: 'Missing Piro signature key configuration' })
      }
      expected = PiroClient.callbackSignature(raw, signatureKey)
    }

    if (expected !== signature) {
      return res.status(400).json({ error: 'Invalid signature' })
    }

    const data = body.data ?? body
    const reference =
      data.client_reference ??
      data.clientReference ??
      data.referenceId ??
      data.reference_id ??
      data.clientRef ??
      data.client_ref ??
      data.refId ??
      data.ref_id

    if (!reference) {
      return res.status(400).json({ error: 'Missing reference' })
    }

    const wr = await prisma.withdrawRequest.findUnique({
      where: { refId: reference },
      select: { status: true, partnerClientId: true, amount: true },
    })

    if (!wr) {
      return res.status(404).json({ error: 'Withdrawal not found' })
    }

    const statusRaw = data.status ?? data.disbursementStatus ?? data.transactionStatus
    const newStatus = mapPiroDisbursement(statusRaw)
    const updateData: any = {
      status: newStatus,
    }

    const gatewayId =
      data.disbursementId ?? data.disbursement_id ?? data.withdrawalId ?? data.withdrawal_id ?? data.id
    if (gatewayId) {
      updateData.paymentGatewayId = String(gatewayId)
    }

    const feeCandidate =
      data.feeAmount ?? data.fee_amount ?? data.fee ?? data.adminFee ?? data.pg_fee ?? data.total_fee
    const feeNumber = typeof feeCandidate === 'number' ? feeCandidate : Number(feeCandidate)
    if (!Number.isNaN(feeNumber) && feeNumber != null) {
      updateData.pgFee = feeNumber
    }

    if (data.accountName || data.account_name) {
      updateData.accountName = data.accountName ?? data.account_name
    }

    if (data.bankName || data.bank_name) {
      updateData.bankName = data.bankName ?? data.bank_name
    }

    if (data.branchName || data.branch_name || data.branchCode || data.branch_code) {
      updateData.branchName =
        data.branchName ?? data.branch_name ?? data.branchCode ?? data.branch_code ?? ''
    }

    const completedAt =
      parseDateSafely(
        data.completedAt ??
          data.completed_at ??
          data.settlementTime ??
          data.settlement_time ??
          data.settledAt ??
          data.settled_at,
      ) ?? null
    if (completedAt) {
      updateData.completedAt = completedAt
    }

    const updateResult = await retry(() =>
      prisma.withdrawRequest.updateMany({
        where: {
          refId: reference,
          status: { in: [DisbursementStatus.PENDING, DisbursementStatus.FAILED] },
        },
        data: updateData,
      })
    )
    const count = (updateResult as { count?: number }).count ?? 0

    if (count > 0 && wr.status !== newStatus) {
      if (wr.status === DisbursementStatus.FAILED && newStatus === DisbursementStatus.COMPLETED) {
        await retry(() =>
          prisma.partnerClient.update({
            where: { id: wr.partnerClientId },
            data: { balance: { decrement: wr.amount } },
          })
        )
      } else if (wr.status === DisbursementStatus.PENDING && newStatus === DisbursementStatus.FAILED) {
        await retry(() =>
          prisma.partnerClient.update({
            where: { id: wr.partnerClientId },
            data: { balance: { increment: wr.amount } },
          })
        )
      }
    }

    return res.status(200).json({ message: 'OK' })
  } catch (err: any) {
    console.error('[withdrawalCallback] error:', err)
    return res.status(500).json({ error: err.message })
  }
}

export const ing1WithdrawalCallback = async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>
    const rcStr = query.rc ?? query.RC
    const statusText = query.status ?? query.STATUS
    const billerReff = query.reff ?? query.reff_id ?? query.biller_reff
    const clientRef =
      query.client_reff ?? query.clientReff ?? query.client_ref ?? query.ref_id ?? query.refId

    if (!clientRef) {
      logger.warn('[ING1 Withdrawal Callback] Missing client reference');
      return res.status(400).json({
        success: false,
        error: 'MISSING_CLIENT_REF',
        message: 'Missing client_reff or ref_id parameter in callback',
        statusCode: 400
      })
    }

    const wr = await prisma.withdrawRequest.findUnique({
      where: { refId: clientRef },
      select: { status: true, partnerClientId: true, amount: true },
    })

    if (!wr) {
      logger.warn('[ING1 Withdrawal Callback] Withdrawal not found', { refId: clientRef });
      return res.status(404).json({
        success: false,
        error: 'WITHDRAWAL_NOT_FOUND',
        message: `Withdrawal with refId ${clientRef} not found in system`,
        statusCode: 404
      })
    }

    const rc = rcStr != null ? Number(rcStr) : null
    const newStatus = mapIng1ToDisbursement(rc, statusText ?? null)

    const updateData: any = {
      status: newStatus,
    }

    if (billerReff) {
      updateData.paymentGatewayId = billerReff
    }

    const feeRaw =
      parseIng1Number(query.fee ?? query.total_fee ?? query.admin_fee ?? query.pg_fee) ?? null
    if (feeRaw != null) {
      updateData.pgFee = feeRaw
    }

    const completedAt =
      parseIng1Date(
        query.completed_at ??
          query.settlement_time ??
          query.settlementTime ??
          query.paid_at ??
          query.paidAt ??
          null
      ) ?? null
    if (completedAt) {
      updateData.completedAt = completedAt
    }

    const result = await prisma.withdrawRequest.updateMany({
      where: {
        refId: clientRef,
        status: { in: [DisbursementStatus.PENDING, DisbursementStatus.FAILED] },
      },
      data: updateData,
    })

    if (result.count === 0) {
      logger.info('[ING1 Withdrawal Callback] No updates needed', { refId: clientRef, newStatus });
      return res.json({
        success: true,
        ok: true,
        updated: false,
        statusCode: 200,
        message: 'Withdrawal already processed'
      })
    }

    if (newStatus === DisbursementStatus.FAILED) {
      await prisma.partnerClient.update({
        where: { id: wr.partnerClientId },
        data: { balance: { increment: wr.amount } },
      })
      logger.info('[ING1 Withdrawal Callback] Withdrawal failed, balance refunded', {
        refId: clientRef,
        amount: wr.amount
      });
    } else if (wr.status === DisbursementStatus.FAILED && newStatus === DisbursementStatus.COMPLETED) {
      await prisma.partnerClient.update({
        where: { id: wr.partnerClientId },
        data: { balance: { decrement: wr.amount } },
      })
      logger.info('[ING1 Withdrawal Callback] Withdrawal completed from failed state', {
        refId: clientRef,
        amount: wr.amount
      });
    }

    return res.json({
      success: true,
      ok: true,
      updated: true,
      statusCode: 200,
      message: 'Withdrawal callback processed successfully',
      refId: clientRef,
      status: newStatus
    })
  } catch (err: any) {
    logger.error('[ING1 Withdrawal Callback] Error:', {
      error: err.message,
      code: err.code,
      stack: err.stack
    });

    // Determine status code based on error
    let statusCode = 500;
    let errorCode = 'INTERNAL_ERROR';
    let message = 'Internal server error processing withdrawal callback';

    if (err.message?.includes('not found') || err.message?.includes('not exist')) {
      statusCode = 404;
      errorCode = 'WITHDRAWAL_NOT_FOUND';
      message = 'Withdrawal not found in system';
    } else if (err.message?.includes('Invalid') || err.message?.includes('Validation')) {
      statusCode = 400;
      errorCode = 'INVALID_PAYLOAD';
      message = 'Invalid callback payload';
    } else if (err.message?.includes('Duplicate')) {
      statusCode = 409;
      errorCode = 'DUPLICATE_CALLBACK';
      message = 'Callback already processed';
    } else if (err.message?.includes('Balance') || err.message?.includes('Insufficient')) {
      statusCode = 422;
      errorCode = 'BALANCE_ERROR';
      message = 'Error processing balance adjustment';
    }

    return res.status(statusCode).json({
      success: false,
      error: errorCode,
      message: message,
      statusCode: statusCode,
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    })
  }
}
export async function validateAccount(req: ClientAuthRequest, res: Response) {
  const {
    account_number,
    bank_code,
    sourceProvider = 'hilogate',
    amount,
    branch_code,
    internal_bank_code,
    bank_name,
    subMerchantId,
  } = req.body as {
    account_number: string
    bank_code: string
    sourceProvider?: 'hilogate' | 'oy' | 'gidi' | 'ing1' | 'piro' | 'genesis'
    amount?: number
    branch_code?: string
    internal_bank_code?: string
    bank_name?: string
    subMerchantId?: string
  }

  try {
    if (isPiroVariant(sourceProvider)) {
      const merchant = await prisma.merchant.findFirst({
        where: { name: 'piro' },
      })
      if (!merchant) {
        return res.status(500).json({ error: 'Internal Piro merchant not found' })
      }

      const subs = await getActiveProviders(merchant.id, 'piro', {})
      if (subs.length === 0) {
        return res.status(500).json({ error: 'No active Piro credentials today' })
      }

      const picked = subMerchantId
        ? subs.find((s) => s.id === subMerchantId) ?? subs[0]
        : subs[0]
      const cfg = picked.config as PiroConfig
      const client = new PiroClient(cfg)

      const validation = await client.validateBankAccount({
        accountNumber: account_number,
        bankCode: bank_code,
        branchCode: branch_code,
        bankIdentifier: internal_bank_code,
        bankName: bank_name,
      })

      if (!validation.isValid) {
        return res.status(400).json({
          error: validation.message || 'Account inquiry failed',
          status: 'invalid',
          code: validation.responseCode,
          bank_name: validation.bankName ?? bank_name ?? null,
          bank_code: validation.bankCode ?? bank_code,
        })
      }

      return res.status(200).json({
        account_number: validation.accountNumber,
        account_holder: validation.accountName ?? '',
        bank_code: validation.bankCode ?? bank_code,
        bank_name: validation.bankName ?? bank_name ?? null,
        branch_code: validation.branchCode ?? branch_code ?? null,
        internal_bank_code: validation.bankIdentifier ?? internal_bank_code ?? null,
        status: 'valid',
        code: validation.responseCode ?? null,
        message: validation.message ?? '',
      })
    }

    if (sourceProvider === 'ing1') {
      const merchant = await prisma.merchant.findFirst({
        where: { name: 'ing1' },
      })
      if (!merchant) {
        return res.status(500).json({ error: 'Internal ING1 merchant not found' })
      }

      const subs = await getActiveProviders(merchant.id, 'ing1', {})
      if (subs.length === 0) {
        return res.status(500).json({ error: 'No active ING1 credentials today' })
      }

      const cfg = subs[0].config as Ing1Config
      const client = new Ing1Client(cfg)
      const clientReff = `inq-${Date.now()}`
      const inquiry = await client.cashoutInquiry({
        bankCode: bank_code,
        accountNumber: account_number,
        amount: amount ?? 0,
        clientReff,
        merchantId: cfg.merchantId,
      })

      if (inquiry.status === 'FAILED') {
        return res.status(400).json({
          error: inquiry.message || 'Account inquiry failed',
          status: 'invalid',
          rc: inquiry.rc,
        })
      }

      return res.status(200).json({
        account_number: inquiry.accountNumber ?? account_number,
        account_holder: inquiry.accountName ?? '',
        bank_code: inquiry.bankCode ?? bank_code,
        bank_name: inquiry.bankName ?? null,
        status: inquiry.status === 'PAID' ? 'valid' : 'pending',
        rc: inquiry.rc,
        reff: inquiry.reff ?? null,
        client_reff: inquiry.clientReff ?? clientReff,
        message: inquiry.message ?? '',
      })
    }

    const merchant = await prisma.merchant.findFirst({
      where: { name: 'hilogate' },
    })
    if (!merchant) {
      return res.status(500).json({ error: 'Internal Hilogate merchant not found' })
    }

    const pc = await prisma.partnerClient.findUnique({
      where: { id: req.partnerClientId! },
      select: { forceSchedule: true },
    })
    const subs = await getActiveProviders(merchant.id, 'hilogate', {
      schedule: (pc?.forceSchedule as any) || undefined,
    })
    if (subs.length === 0) {
      return res.status(500).json({ error: 'No active Hilogate credentials today' })
    }
    const cfg = subs[0].config as unknown as HilogateConfig

    const client = new HilogateClient(cfg)
    const payload = await client.validateAccount(account_number, bank_code)
    console.log('payload:', payload)
    if (payload.status !== 'valid' ||  payload.account_holder === '-') {
      return res.status(400).json({ error: 'Invalid account' })
    }
  

    return res.json({
      account_number: payload.account_number,
      account_holder: payload.account_holder,
      bank_code: payload.bank_code,
      status: payload.status,
    })
  } catch (err: any) {
    console.error('[validateAccount] error:', err)
    return res
      .status(500)
      .json({ message: err.message || 'Validasi akun gagal' })
  }
}

export async function validateAccountS2S(req: ApiKeyRequest, res: Response) {
  const {
    account_number,
    bank_code,
    sourceProvider = 'hilogate',
    amount,
    branch_code,
    internal_bank_code,
    bank_name,
    subMerchantId,
  } = req.body as {
    account_number: string
    bank_code: string
    sourceProvider?: 'hilogate' | 'oy' | 'gidi' | 'ing1' | 'piro' | 'genesis'
    amount?: number
    branch_code?: string
    internal_bank_code?: string
    bank_name?: string
    subMerchantId?: string
  }

  try {
    if (sourceProvider === 'ing1') {
      const merchant = await prisma.merchant.findFirst({
        where: { name: 'ing1' },
      })
      if (!merchant) {
        return res.status(500).json({ error: 'Internal ING1 merchant not found' })
      }

      const subs = await getActiveProviders(merchant.id, 'ing1', {})
      if (subs.length === 0) {
        return res.status(500).json({ error: 'No active ING1 credentials today' })
      }

      const cfg = subs[0].config as Ing1Config
      const client = new Ing1Client(cfg)
      const clientReff = `inq-${Date.now()}`
      const inquiry = await client.cashoutInquiry({
        bankCode: bank_code,
        accountNumber: account_number,
        amount: amount ?? 0,
        clientReff,
        merchantId: cfg.merchantId,
      })

      if (inquiry.status === 'FAILED') {
        return res.status(400).json({
          error: inquiry.message || 'Account inquiry failed',
          status: 'invalid',
          rc: inquiry.rc,
        })
      }

      return res.json({
        account_number: inquiry.accountNumber ?? account_number,
        account_holder: inquiry.accountName ?? '',
        bank_code: inquiry.bankCode ?? bank_code,
        bank_name: inquiry.bankName ?? null,
        status: inquiry.status === 'PAID' ? 'valid' : 'pending',
        rc: inquiry.rc,
        reff: inquiry.reff ?? null,
        client_reff: inquiry.clientReff ?? clientReff,
        message: inquiry.message ?? '',
      })
    }

    const merchant = await prisma.merchant.findFirst({
      where: { name: 'hilogate' },
    })
    if (!merchant) {
      return res.status(500).json({ error: 'Internal Hilogate merchant not found' })
    }

    const pc = await prisma.partnerClient.findUnique({
      where: { id: req.clientId! },
      select: { forceSchedule: true },
    })
    const subs = await getActiveProviders(merchant.id, 'hilogate', {
      schedule: (pc?.forceSchedule as any) || undefined,
    })
    if (subs.length === 0) {
      return res.status(500).json({ error: 'No active Hilogate credentials today' })
    }
    const cfg = subs[0].config as unknown as HilogateConfig

    const client = new HilogateClient(cfg)
    const payload = await client.validateAccount(account_number, bank_code)
    if (payload.status !== 'valid') {
      return res.status(400).json({ error: 'Invalid account' })
    }
    return res.json({
      account_number: payload.account_number,
      account_holder: payload.account_holder,
      bank_code: payload.bank_code,
      status: payload.status,
    })
  } catch (err: any) {
    console.error('[validateAccountS2S] error:', err)
    return res.status(500).json({ message: err.message || 'Validasi akun gagal' })
  }
}

/**
 * POST /api/v1/client/dashboard/withdraw
 */
export const requestWithdraw = async (req: ClientAuthRequest, res: Response) => {
  const {
    subMerchantId,
    sourceProvider,
    account_number,
    bank_code,
    account_name_alias,
    amount,
    otp,
    account_name,
    bank_name,
    branch_code,
    internal_bank_code,
    type = 'single',
    bulk_id,
  } = req.body as {
    subMerchantId: string
    sourceProvider: 'hilogate' | 'oy' | 'gidi' | 'ing1' | 'piro' | 'genesis'
    account_number: string
    bank_code: string
    account_name_alias?: string
    amount: number
    otp?: string
    account_name?: string
    bank_name?: string
    branch_code?: string
    internal_bank_code?: string
    type?: 'single' | 'bulk'
    bulk_id?: string

  }

    // Parent accounts are not allowed to perform withdrawals
  if (req.isParent) {
    return res.status(403).json({ error: 'Parent accounts cannot perform withdrawals' })
  }
  const clientUserId = req.clientUserId!

  // 0) Cari partnerClientId dari clientUser
  const user = await prisma.clientUser.findUnique({
    where: { id: clientUserId },
    select: { partnerClientId: true, totpEnabled: true, totpSecret: true }
  })
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
  const partnerClientId = user.partnerClientId
  if (user.totpEnabled) {
    if (!otp) return res.status(400).json({ error: 'OTP wajib diisi' })
    if (!user.totpSecret || !authenticator.check(String(otp), user.totpSecret)) {
      return res.status(400).json({ error: 'OTP tidak valid' })
    }
  }

    // 0a) Validate against global withdraw limits
  const [minSet, maxSet] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'withdraw_min' } }),
    prisma.setting.findUnique({ where: { key: 'withdraw_max' } })
  ])
  const minVal = parseFloat(minSet?.value ?? '0')
  const maxVal = parseFloat(maxSet?.value ?? '0')
  if (!isNaN(minVal) && minVal > 0 && amount < minVal) {
    return res.status(400).json({ error: `Minimum withdraw Rp ${minVal}` })
  }
  if (!isNaN(maxVal) && maxVal > 0 && amount > maxVal) {
    return res.status(400).json({ error: `Maximum withdraw Rp ${maxVal}` })
  }

  try {
    const sub = await prisma.sub_merchant.findUnique({
      where: { id: subMerchantId },
      select: { credentials: true, provider: true }
    })
    if (!sub) throw new Error('Credentials not found for sub-merchant')

    // Cast sesuai provider
    let providerCfg: any
    let hilogateClient: HilogateClient | null = null
    let oyClient: OyClient | null = null
    let gidiClient: GidiClient | null = null
    let ingClient: Ing1Client | null = null
    let ingCfg: Ing1Config | null = null
    let piroClient: PiroClient | null = null
    let piroCfg: PiroConfig | null = null

    if (sourceProvider === 'hilogate') {
      const raw = sub.credentials as { merchantId: string; secretKey: string; env?: string }
      providerCfg = {
        merchantId: raw.merchantId,
        secretKey: raw.secretKey,
        env: raw.env ?? 'sandbox',
      } as HilogateConfig
      hilogateClient = new HilogateClient(providerCfg)
    } else if (sourceProvider === 'oy') {
      const raw = sub.credentials as { merchantId: string; secretKey: string }
      providerCfg = {
        baseUrl: 'https://partner.oyindonesia.com',
        username: raw.merchantId,
        apiKey: raw.secretKey,
      } as OyConfig
      oyClient = new OyClient(providerCfg)
    } else if (sourceProvider === 'gidi') {
      const raw = sub.credentials as { baseUrl: string; merchantId: string; credentialKey: string }
      providerCfg = {
        baseUrl: raw.baseUrl,
        merchantId: raw.merchantId,
        credentialKey: raw.credentialKey,
      } as GidiDisbursementConfig
      gidiClient = new GidiClient(providerCfg)
    } else if (isPiroVariant(sourceProvider)) {
      const merchant = await prisma.merchant.findFirst({ where: { name: 'piro' } })
      if (!merchant) throw new Error('Internal Piro merchant not found')

      const subs = await getActiveProviders(merchant.id, 'piro', {})
      if (!subs.length) throw new Error('No active Piro credentials today')

      const picked = subs.find((s) => s.id === subMerchantId) ?? subs[0]
      if (!picked) throw new Error('Active Piro credentials not found for sub-merchant')

      piroCfg = picked.config as PiroConfig
      providerCfg = piroCfg
      piroClient = new PiroClient(piroCfg)
    } else {
      const raw = sub.credentials as unknown as Ing1Config
      ingCfg = {
        baseUrl: raw.baseUrl,
        email: raw.email,
        password: raw.password,
        productCode: raw.productCode,
        callbackUrl: raw.callbackUrl,
        permanentToken: raw.permanentToken,
        merchantId: raw.merchantId,
        apiVersion: raw.apiVersion,
      }
      providerCfg = ingCfg
      ingClient = new Ing1Client(ingCfg)
    }

    const withdrawRef = `wd-${Date.now()}`

    // 3-4) Validasi akun & dapatkan bankName / holder
    let acctHolder: string
    let alias: string
    let bankName: string
      let branchName = ''
      let bankIdentifier: string | undefined

      if (sourceProvider === 'hilogate') {
      const valid = await hilogateClient!.validateAccount(account_number, bank_code)
      if (valid.status !== 'valid') {
        return res.status(400).json({ error: 'Akun bank tidak valid' })
      }
      acctHolder = valid.account_holder
      alias = account_name_alias || acctHolder
      const banks = await hilogateClient!.getBankCodes()
      const b = banks.find(b => b.code === bank_code)
      if (!b) return res.status(400).json({ error: 'Bank code tidak dikenal' })
      bankName = b.name
    } else if (sourceProvider === 'gidi') {
      let inq
      try {
        inq = await gidiClient!.inquiryAccount(bank_code, account_number, Date.now().toString())
      } catch (err: any) {
        return res.status(400).json({ error: err.message })
      }
      acctHolder = inq.beneficiaryAccountName
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name
    } else if (sourceProvider === 'oy') {
      acctHolder = req.body.account_name || ''
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name
    } else if (isPiroVariant(sourceProvider)) {
      if (!piroClient || !piroCfg) {
        throw new Error('Missing Piro client configuration')
      }
      const validation = await piroClient.validateBankAccount({
        accountNumber: account_number,
        bankCode: bank_code,
        branchCode: branch_code,
        bankIdentifier: internal_bank_code,
        bankName: bank_name,
      })

      if (!validation.isValid) {
        return res.status(400).json({
          error: validation.message || 'Akun bank tidak valid',
          code: validation.responseCode,
        })
      }

      acctHolder = validation.accountName ?? account_name ?? ''
      alias = account_name_alias || acctHolder
      bankName = validation.bankName ?? bank_name ?? ''
      branchName = validation.branchCode ?? branch_code ?? ''
      bankIdentifier = validation.bankIdentifier ?? internal_bank_code ?? undefined
    } else {
      acctHolder = req.body.account_name || ''
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name || ''
    }

    // 5) Atomic transaction: hitung balance, fee, buat record, hold saldo
    const wr = await prisma.$transaction(async tx => {
      // a) Ambil fee withdraw
      const pc = await tx.partnerClient.findUniqueOrThrow({
        where: { id: partnerClientId },
        select: { withdrawFeePercent: true, withdrawFeeFlat: true }
      })

      // b) Hitung total masuk (settled) dari transaction_request
  const inAgg = await tx.order.aggregate({
    _sum: { settlementAmount: true },
    where: {
      subMerchantId,
      partnerClientId,
      settlementTime: { not: null }
    }
  })
      const totalIn = inAgg._sum.settlementAmount ?? 0

      // c) Hitung total keluar (withdraw) dari WithdrawRequest
      // Use netAmount + pgFee because that's what actually leaves the wallet
      const outAgg = await tx.withdrawRequest.aggregate({
        _sum: { netAmount: true, pgFee: true },
        where: {
          subMerchantId,
          partnerClientId,
          status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] }
        }
      })
      const totalOutNet = outAgg._sum.netAmount ?? 0
      const totalOutFee = outAgg._sum.pgFee ?? 0
      const totalOut = totalOutNet + totalOutFee

      // d) Validasi available balance
      const available = totalIn - totalOut

      // Additional safety check: prevent withdrawals if wallet balance is negative
      if (available < 0) {
        throw new Error('WalletNegativeBalance')
      }

      if (amount > available) throw new Error('InsufficientBalance')

      // e) Hitung fee dan net amount
      const feePctAmt = (pc.withdrawFeePercent / 100) * amount
      const netAmt = amount - feePctAmt - pc.withdrawFeeFlat

      // f) Buat WithdrawRequest dengan nested connect
      const refId = withdrawRef
      const w = await tx.withdrawRequest.create({
        data: {
          refId,
          amount,
          netAmount: netAmt,
          status: DisbursementStatus.PENDING,
          withdrawFeePercent: pc.withdrawFeePercent,
          withdrawFeeFlat: pc.withdrawFeeFlat,
          sourceProvider,
          type: type,
          bulkId: bulk_id,
          partnerClient: { connect: { id: partnerClientId } },
          subMerchant:    { connect: { id: subMerchantId } },
          accountName:      acctHolder,
          accountNameAlias: alias,
          accountNumber:    account_number,
          bankCode:         bank_code,
          bankName,
          branchName
        }
      })

      // g) Hold saldo di PartnerClient
      await tx.partnerClient.update({
        where: { id: partnerClientId },
        data: { balance: { decrement: amount } }
      })

      return w
    })

       try {
      let resp: any
      let ingInquiry: {
        reff?: string | null
        fee?: number | null
        accountName?: string | null
        bankName?: string | null
      } | null = null

      if (sourceProvider === 'hilogate') {
        resp = await hilogateClient!.createWithdrawal({
          ref_id:             wr.refId,
          amount:             wr.netAmount,                // ← netAmt
          currency:           'IDR',
          account_number,
          account_name:       wr.accountName,
          account_name_alias: wr.accountNameAlias,
          bank_code,
          bank_name:          wr.bankName,
          branch_name:        '',
          description:        `Withdraw Rp ${wr.netAmount}` // ← catatan juga netAmt
        })
      } else if (sourceProvider === 'gidi') {
        resp = await gidiClient!.createTransfer({
          requestId: `${wr.refId}-r`,
          transactionId: wr.refId,
          channelId: bank_code,
          accountNo: account_number,
          amount: wr.netAmount,
          transferNote: `Withdraw Rp ${wr.netAmount}`,
        })
      } else if (sourceProvider === 'oy') {
        const disburseReq = {
          recipient_bank:     bank_code,
          recipient_account:  account_number,
          amount:             wr.netAmount,                // ← netAmt
          note:               `Withdraw Rp ${wr.netAmount}`, // ← catatan juga netAmt
          partner_trx_id:     wr.refId,
          email:             'client@launcx.com',  // ← hardcode di sini'

        }
        resp = await oyClient!.disburse(disburseReq)
      } 

      // Map response code ke DisbursementStatus
      const newStatus = sourceProvider === 'hilogate'
        ? (['WAITING','PENDING'].includes(resp.status)
            ? DisbursementStatus.PENDING
            : ['COMPLETED','SUCCESS'].includes(resp.status)
              ? DisbursementStatus.COMPLETED
              : DisbursementStatus.FAILED)
        : sourceProvider === 'gidi'
          ? (resp.statusTransfer === 'Success'
              ? DisbursementStatus.COMPLETED
              : resp.statusTransfer === 'Failed'
                ? DisbursementStatus.FAILED
                : DisbursementStatus.PENDING)
          : sourceProvider === 'oy'
            ? (resp.status.code === '101'
                ? DisbursementStatus.PENDING
                : resp.status.code === '000'
                  ? DisbursementStatus.COMPLETED
                  : DisbursementStatus.FAILED)
            : isPiroVariant(sourceProvider)
              ? mapPiroDisbursement(resp.status)
              : mapIng1ToDisbursement(
                  resp.rc,
                  typeof resp?.raw?.status === 'string' ? resp.raw.status : resp.status,
                )

      // Update withdrawal record
      await prisma.withdrawRequest.update({
        where: { refId: wr.refId },
        data: {
          paymentGatewayId:
            sourceProvider === 'ing1'
              ? resp.reff ?? resp.raw?.reff ?? ingInquiry?.reff ?? null
              : isPiroVariant(sourceProvider)
                ? resp.withdrawalId ?? resp.referenceId ?? null
                : resp.trx_id || resp.trxId || resp.transactionId,
          isTransferProcess: sourceProvider === 'hilogate' ? (resp.is_transfer_process ?? false) : true,
          status: newStatus,
          ...(sourceProvider === 'ing1'
            ? (() => {
                const feeRaw =
                  parseIng1Number(resp?.data?.fee ?? resp?.data?.total_fee ?? resp?.data?.admin_fee?.total_fee) ??
                  (typeof ingInquiry?.fee === 'number' ? ingInquiry.fee : null)
                return feeRaw != null ? { pgFee: feeRaw } : {}
              })()
            : isPiroVariant(sourceProvider)
              ? (() => {
                  const updates: any = {}
                  if (resp.feeAmount != null) {
                    updates.pgFee = resp.feeAmount
                  }
                  if (resp.accountName) {
                    updates.accountName = resp.accountName
                  }
                  if (resp.bankName) {
                    updates.bankName = resp.bankName
                  }
                  const branchCandidate = resp.branchName ?? branchName ?? branch_code ?? null
                  if (branchCandidate) {
                    updates.branchName = branchCandidate
                  }
                  return updates
                })()
              : {}),
        }
      })

      if (newStatus === DisbursementStatus.FAILED) {
        await prisma.partnerClient.update({
          where: { id: partnerClientId },
          data: { balance: { increment: amount } }
        })
        return res.status(400).json({
          error:
            isPiroVariant(sourceProvider)
              ? resp.message || 'Withdrawal failed'
              : 'Withdrawal failed',
          status: resp.status,
          code: resp.responseCode,
        })
      }

      // Invalidate all related caches after successful withdrawal
      const { cacheDelPattern } = await import('../core/redis')
      await Promise.all([
        cacheDelPattern(`withdrawals:*`),
        cacheDelPattern(`submerchants:*`),
        cacheDelPattern(`dashboard:${clientUserId}:*`)
      ]).catch(err => logger.error('[requestWithdraw] Cache invalidation failed:', err))

      return res.status(201).json({ id: wr.id, refId: wr.refId, status: newStatus })
    } catch (err: any) {
      logger.error('[requestWithdraw provider]', err)
      try {
        await prisma.$transaction([
          prisma.withdrawRequest.update({
            where: { refId: wr.refId },
            data: { status: DisbursementStatus.FAILED }
          }),
          prisma.partnerClient.update({
            where: { id: partnerClientId },
            data: { balance: { increment: amount } }
          })
        ])
      } catch (rollbackErr) {
        logger.error('[requestWithdraw rollback]', rollbackErr)
      }
      const status = err instanceof GidiError ? 400 : 500
      return res.status(status).json({ error: err.message || 'Internal server error' })
    }
  } catch (err: any) {
    if (err.message === 'WalletNegativeBalance')
      return res.status(400).json({ error: 'Wallet has negative balance. Please contact support.' })
    if (err.message === 'InsufficientBalance')
      return res.status(400).json({ error: 'Saldo tidak mencukupi' })
    if (err instanceof GidiError)
      return res.status(400).json({ error: err.message })
    logger.error('[requestWithdraw]', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

export const requestWithdrawS2S = async (req: ApiKeyRequest, res: Response) => {
  const {
    subMerchantId,
    sourceProvider,
    account_number,
    bank_code,
    account_name_alias,
    amount,
    account_name,
    bank_name,
    branch_code,
    internal_bank_code,
    type = 'single',
    bulk_id,
  } = req.body as {
    subMerchantId: string
    sourceProvider: 'hilogate' | 'oy' | 'gidi' | 'ing1' | 'piro' | 'genesis'
    account_number: string
    bank_code: string
    account_name_alias?: string
    amount: number
    account_name?: string
    bank_name?: string
    branch_code?: string
    internal_bank_code?: string
    type?: 'single' | 'bulk'
    bulk_id?: string
  }

  if (req.isParent) {
    return res.status(403).json({ error: 'Parent accounts cannot perform withdrawals' })
  }
  const partnerClientId = req.clientId!

  const [minSet, maxSet] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'withdraw_min' } }),
    prisma.setting.findUnique({ where: { key: 'withdraw_max' } }),
  ])
  const minVal = parseFloat(minSet?.value ?? '0')
  const maxVal = parseFloat(maxSet?.value ?? '0')
  if (!isNaN(minVal) && minVal > 0 && amount < minVal) {
    return res.status(400).json({ error: `Minimum withdraw Rp ${minVal}` })
  }
  if (!isNaN(maxVal) && maxVal > 0 && amount > maxVal) {
    return res.status(400).json({ error: `Maximum withdraw Rp ${maxVal}` })
  }

  try {
    const sub = await prisma.sub_merchant.findUnique({
      where: { id: subMerchantId },
      select: { credentials: true, provider: true },
    })
    if (!sub) throw new Error('Credentials not found for sub-merchant')

    let providerCfg: any
    let hilogateClient: HilogateClient | null = null
    let oyClient: OyClient | null = null
    let gidiClient: GidiClient | null = null
    let ingClient: Ing1Client | null = null
    let ingCfg: Ing1Config | null = null
    let piroClient: PiroClient | null = null
    let piroCfg: PiroConfig | null = null

    if (sourceProvider === 'hilogate') {
      const raw = sub.credentials as { merchantId: string; secretKey: string; env?: string }
      providerCfg = {
        merchantId: raw.merchantId,
        secretKey: raw.secretKey,
        env: raw.env ?? 'sandbox',
      } as HilogateConfig
      hilogateClient = new HilogateClient(providerCfg)
    } else if (sourceProvider === 'oy') {
      const raw = sub.credentials as { merchantId: string; secretKey: string }
      providerCfg = {
        baseUrl: 'https://partner.oyindonesia.com',
        username: raw.merchantId,
        apiKey: raw.secretKey,
      } as OyConfig
      oyClient = new OyClient(providerCfg)
    } else if (sourceProvider === 'gidi') {
      const raw = sub.credentials as { baseUrl: string; merchantId: string; credentialKey: string }
      providerCfg = {
        baseUrl: raw.baseUrl,
        merchantId: raw.merchantId,
        credentialKey: raw.credentialKey,
      } as GidiDisbursementConfig
      gidiClient = new GidiClient(providerCfg)
    } else if (isPiroVariant(sourceProvider)) {
      const merchant = await prisma.merchant.findFirst({ where: { name: 'piro' } })
      if (!merchant) throw new Error('Internal Piro merchant not found')

      const subs = await getActiveProviders(merchant.id, 'piro', {})
      if (!subs.length) throw new Error('No active Piro credentials today')

      const picked = subs.find((s) => s.id === subMerchantId) ?? subs[0]
      if (!picked) throw new Error('Active Piro credentials not found for sub-merchant')

      piroCfg = picked.config as PiroConfig
      providerCfg = piroCfg
      piroClient = new PiroClient(piroCfg)
    } else {
      const raw = sub.credentials as unknown as Ing1Config
      ingCfg = {
        baseUrl: raw.baseUrl,
        email: raw.email,
        password: raw.password,
        productCode: raw.productCode,
        callbackUrl: raw.callbackUrl,
        permanentToken: raw.permanentToken,
        merchantId: raw.merchantId,
        apiVersion: raw.apiVersion,
      }
      providerCfg = ingCfg
      ingClient = new Ing1Client(ingCfg)
    }

    const withdrawRef = `wd-${Date.now()}`

    let acctHolder: string
    let alias: string
    let bankName: string
    let branchName = ''
    let bankIdentifier: string | undefined

    if (sourceProvider === 'hilogate') {
      const valid = await hilogateClient!.validateAccount(account_number, bank_code)
      if (valid.status !== 'valid') {
        return res.status(400).json({ error: 'Akun bank tidak valid' })
      }
      acctHolder = valid.account_holder
      alias = account_name_alias || acctHolder
      const banks = await hilogateClient!.getBankCodes()
      const b = banks.find(b => b.code === bank_code)
      if (!b) return res.status(400).json({ error: 'Bank code tidak dikenal' })
      bankName = b.name
    } else if (sourceProvider === 'gidi') {
      let inq
      try {
        inq = await gidiClient!.inquiryAccount(bank_code, account_number, Date.now().toString())
      } catch (err: any) {
        return res.status(400).json({ error: err.message })
      }
      acctHolder = inq.beneficiaryAccountName
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name
    } else if (sourceProvider === 'oy') {
      acctHolder = req.body.account_name || ''
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name
    } else if (isPiroVariant(sourceProvider)) {
      if (!piroClient || !piroCfg) {
        throw new Error('Missing Piro client configuration')
      }
      const validation = await piroClient.validateBankAccount({
        accountNumber: account_number,
        bankCode: bank_code,
        branchCode: branch_code,
        bankIdentifier: internal_bank_code,
        bankName: bank_name,
      })

      if (!validation.isValid) {
        return res.status(400).json({
          error: validation.message || 'Akun bank tidak valid',
          code: validation.responseCode,
        })
      }

      acctHolder = validation.accountName ?? account_name ?? ''
      alias = account_name_alias || acctHolder
      bankName = validation.bankName ?? bank_name ?? ''
      branchName = validation.branchCode ?? branch_code ?? ''
      bankIdentifier = validation.bankIdentifier ?? internal_bank_code ?? undefined
    } else {
      acctHolder = req.body.account_name || ''
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name || ''
    }

    const wr = await prisma.$transaction(async tx => {
      const pc = await tx.partnerClient.findUniqueOrThrow({
        where: { id: partnerClientId },
        select: { withdrawFeePercent: true, withdrawFeeFlat: true },
      })

      const inAgg = await tx.order.aggregate({
        _sum: { settlementAmount: true },
        where: {
          subMerchantId,
          partnerClientId,
          settlementTime: { not: null },
        },
      })
      const totalIn = inAgg._sum.settlementAmount ?? 0

      const outAgg = await tx.withdrawRequest.aggregate({
        _sum: { amount: true },
        where: {
          subMerchantId,
          partnerClientId,
          status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] },
        },
      })
      const totalOut = outAgg._sum.amount ?? 0

      const available = totalIn - totalOut

      // Additional safety check: prevent withdrawals if wallet balance is negative
      if (available < 0) {
        throw new Error('WalletNegativeBalance')
      }

      if (amount > available) throw new Error('InsufficientBalance')

      const feePctAmt = (pc.withdrawFeePercent / 100) * amount
      const netAmt = amount - feePctAmt - pc.withdrawFeeFlat

      const refId = withdrawRef
      const w = await tx.withdrawRequest.create({
        data: {
          refId,
          amount,
          netAmount: netAmt,
          status: DisbursementStatus.PENDING,
          withdrawFeePercent: pc.withdrawFeePercent,
          withdrawFeeFlat: pc.withdrawFeeFlat,
          sourceProvider,
          type: type,
          bulkId: bulk_id,
          partnerClient: { connect: { id: partnerClientId } },
          subMerchant: { connect: { id: subMerchantId } },
          accountName: acctHolder,
          accountNameAlias: alias,
          accountNumber: account_number,
          bankCode: bank_code,
          bankName,
          branchName,
        },
      })

      await tx.partnerClient.update({
        where: { id: partnerClientId },
        data: { balance: { decrement: amount } },
      })

      return w
    })

    try {
      let resp: any
      let ingInquiry: {
        reff?: string | null
        fee?: number | null
        accountName?: string | null
        bankName?: string | null
      } | null = null

      if (sourceProvider === 'hilogate') {
        resp = await hilogateClient!.createWithdrawal({
          ref_id: wr.refId,
          amount: wr.netAmount,
          currency: 'IDR',
          account_number,
          account_name: wr.accountName,
          account_name_alias: wr.accountNameAlias,
          bank_code,
          bank_name: wr.bankName,
          branch_name: '',
          description: `Withdraw Rp ${wr.netAmount}`,
        })
      } else if (sourceProvider === 'gidi') {
        resp = await gidiClient!.createTransfer({
          requestId: `${wr.refId}-r`,
          transactionId: wr.refId,
          channelId: bank_code,
          accountNo: account_number,
          amount: wr.netAmount,
          transferNote: `Withdraw Rp ${wr.netAmount}`,
        })
      } else if (sourceProvider === 'oy') {
        const disburseReq = {
          recipient_bank: bank_code,
          recipient_account: account_number,
          amount: wr.netAmount,
          note: `Withdraw Rp ${wr.netAmount}`,
          partner_trx_id: wr.refId,
          email: 'client@launcx.com',
        }
        resp = await oyClient!.disburse(disburseReq)
      } 

      const newStatus =
        sourceProvider === 'hilogate'
          ? ['WAITING', 'PENDING'].includes(resp.status)
            ? DisbursementStatus.PENDING
            : ['COMPLETED', 'SUCCESS'].includes(resp.status)
              ? DisbursementStatus.COMPLETED
              : DisbursementStatus.FAILED
          : sourceProvider === 'gidi'
            ? resp.statusTransfer === 'Success'
              ? DisbursementStatus.COMPLETED
              : resp.statusTransfer === 'Failed'
                ? DisbursementStatus.FAILED
                : DisbursementStatus.PENDING
            : sourceProvider === 'oy'
              ? resp.status.code === '101'
                ? DisbursementStatus.PENDING
                : resp.status.code === '000'
                  ? DisbursementStatus.COMPLETED
                  : DisbursementStatus.FAILED
              : isPiroVariant(sourceProvider)
                ? mapPiroDisbursement(resp.status)
                : mapIng1ToDisbursement(
                    resp.rc,
                    typeof resp?.raw?.status === 'string' ? resp.raw.status : resp.status,
                  )

      await prisma.withdrawRequest.update({
        where: { refId: wr.refId },
        data: {
          paymentGatewayId:
            sourceProvider === 'ing1'
              ? resp.reff ?? resp.raw?.reff ?? ingInquiry?.reff ?? null
              : isPiroVariant(sourceProvider)
                ? resp.withdrawalId ?? resp.referenceId ?? null
                : resp.trx_id || resp.trxId || resp.transactionId,
          isTransferProcess:
            sourceProvider === 'hilogate' ? resp.is_transfer_process ?? false : true,
          status: newStatus,
          ...(sourceProvider === 'ing1'
            ? (() => {
                const feeRaw =
                  parseIng1Number(resp?.data?.fee ?? resp?.data?.total_fee ?? resp?.data?.admin_fee?.total_fee) ??
                  (typeof ingInquiry?.fee === 'number' ? ingInquiry.fee : null)
                return feeRaw != null ? { pgFee: feeRaw } : {}
              })()
            : isPiroVariant(sourceProvider)
              ? (() => {
                  const updates: any = {}
                  if (resp.feeAmount != null) {
                    updates.pgFee = resp.feeAmount
                  }
                  if (resp.accountName) {
                    updates.accountName = resp.accountName
                  }
                  if (resp.bankName) {
                    updates.bankName = resp.bankName
                  }
                  const branchCandidate = resp.branchName ?? branchName ?? branch_code ?? null
                  if (branchCandidate) {
                    updates.branchName = branchCandidate
                  }
                  return updates
                })()
              : {}),
        },
      })

      if (newStatus === DisbursementStatus.FAILED) {
        await prisma.partnerClient.update({
          where: { id: partnerClientId },
          data: { balance: { increment: amount } },
        })
        return res.status(400).json({
          error:
            isPiroVariant(sourceProvider)
              ? resp.message || 'Withdrawal failed'
              : 'Withdrawal failed',
          status: resp.status,
          code: resp.responseCode,
        })
      }

      return res.status(201).json({ id: wr.id, refId: wr.refId, status: newStatus })
    } catch (err: any) {
      logger.error('[requestWithdrawS2S provider]', err)
      try {
        await prisma.$transaction([
          prisma.withdrawRequest.update({
            where: { refId: wr.refId },
            data: { status: DisbursementStatus.FAILED },
          }),
          prisma.partnerClient.update({
            where: { id: partnerClientId },
            data: { balance: { increment: amount } },
          }),
        ])
      } catch (rollbackErr) {
        logger.error('[requestWithdrawS2S rollback]', rollbackErr)
      }
      const status = err instanceof GidiError ? 400 : 500
      return res.status(status).json({ error: err.message || 'Internal server error' })
    }
  } catch (err: any) {
    if (err.message === 'InsufficientBalance')
      return res.status(400).json({ error: 'Saldo tidak mencukupi' })
    if (err instanceof GidiError)
      return res.status(400).json({ error: err.message })
    logger.error('[requestWithdrawS2S]', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

export async function getBanks(req: ClientAuthRequest, res: Response) {
  try {
    const clientUserId = req.clientUserId!

    const userWithClient = await prisma.clientUser.findUnique({
      where: { id: clientUserId },
      select: { partnerClientId: true }
    })

    if (!userWithClient) {
      return res.status(404).json({ error: 'User tidak ditemukan' })
    }

    const merchant = await prisma.merchant.findFirst({
      where: { name: 'ing1' }
    })

    if (!merchant) {
      return res.status(500).json({
        error: 'INA merchant tidak ditemukan dalam sistem'
      })
    }

    const now = new Date()
    const day = now.getDay()
    const isWeekend = day === 0 || day === 6
    const isWeekday = !isWeekend

    const subMerchant = await prisma.sub_merchant.findFirst({
      where: {
        merchantId: merchant.id,
        provider: 'ing1'
      }
    })

    if (!subMerchant) {
      return res.status(500).json({
        error: 'Sub-merchant INA tidak ditemukan dalam sistem'
      })
    }

    const schedule = subMerchant.schedule as any
    if (isWeekday && !schedule?.weekday) {
      return res.status(503).json({
        error: 'Layanan INA tidak aktif hari Senin-Jumat'
      })
    }
    if (isWeekend && !schedule?.weekend) {
      return res.status(503).json({
        error: 'Layanan INA tidak aktif hari Sabtu-Minggu'
      })
    }

    // INA Billers Engine supported banks for withdrawals
    // These are the banks supported by the cashout/payment API endpoint
    const inaBanks = [
      { code: 'BCA', name: 'Bank Central Asia' },
      { code: 'BNI', name: 'Bank Negara Indonesia' },
      { code: 'MANDIRI', name: 'Bank Mandiri' },
      { code: 'BRI', name: 'Bank Rakyat Indonesia' },
      { code: 'CIMB', name: 'CIMB Niaga' },
      { code: 'MAYBANK', name: 'Maybank' },
      { code: 'PERMATA', name: 'Bank Permata' },
      { code: 'DANAMON', name: 'Bank Danamon' },
      { code: 'OKE', name: 'Bank OKE' },
      { code: 'MEGA', name: 'Bank Mega' },
      { code: 'BTN', name: 'Bank Tabungan Negara' },
      { code: 'BSI', name: 'Bank Syariah Indonesia' },
      { code: 'PANIN', name: 'Bank Panin' },
      { code: 'OCBC', name: 'OCBC NISP' },
      { code: 'UOB', name: 'UOB Bank' },
      { code: 'DBS', name: 'Bank DBS' },
      { code: 'HSBC', name: 'HSBC Bank' }
    ]

    return res.json({ banks: inaBanks })
  } catch (err: any) {
    logger.error('[getBanks] Unexpected error:', err)
    return res.status(500).json({
      error: err.message || 'Gagal mengambil daftar bank'
    })
  }
}

/**
 * POST /api/v1/client/dashboard/withdraw/bulk
 */
export const requestBulkWithdraw = async (req: ClientAuthRequest, res: Response) => {
  const { otp, withdrawals } = req.body as {
    otp: string
    withdrawals: Array<{
      subMerchantId: string
      sourceProvider: 'hilogate' | 'oy' | 'gidi' | 'ing1' | 'piro' | 'genesis'
      account_number: string
      bank_code: string
      account_name_alias?: string
      amount: number
      account_name?: string
      bank_name?: string
      branch_code?: string
      internal_bank_code?: string
    }>
  }

  // Validasi parent account
  if (req.isParent) {
    return res.status(403).json({ error: 'Parent accounts cannot perform withdrawals' })
  }

  const clientUserId = req.clientUserId!

  // Validasi input
  if (!withdrawals || !Array.isArray(withdrawals) || withdrawals.length === 0) {
    return res.status(400).json({ error: 'Withdrawals list is required and must not be empty' })
  }

  if (withdrawals.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 withdrawals per bulk request' })
  }

  try {
    // 1) Ambil user data
    const user = await prisma.clientUser.findUnique({
      where: { id: clientUserId },
      select: { partnerClientId: true, totpEnabled: true, totpSecret: true }
    })

    if (!user) {
      return res.status(404).json({ error: 'User tidak ditemukan' })
    }

    // 2) Verifikasi OTP SEKALI untuk semua withdrawals
    if (user.totpEnabled) {
      if (!otp) {
        return res.status(400).json({ error: 'OTP wajib diisi untuk bulk withdrawal' })
      }

      if (!user.totpSecret || !authenticator.check(String(otp), user.totpSecret)) {
        return res.status(400).json({ error: 'OTP tidak valid' })
      }

      logger.info(`[requestBulkWithdraw] OTP verified for user ${clientUserId}`)
    }

    // 3) Generate bulk ID untuk tracking
    const bulkId = `bulk-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`

    // 4) Process setiap withdrawal
    const results: Array<{
      index: number
      success: boolean
      refId?: string
      id?: string
      status?: string
      error?: string
    }> = []

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < withdrawals.length; i++) {
      const item = withdrawals[i]
      
      try {
        // Panggil logic yang sama dengan requestWithdraw
        const result = await processWithdrawal({
          ...item,
          type: 'bulk',
          bulk_id: bulkId,
          clientUserId,
          partnerClientId: user.partnerClientId,
          skipOtpCheck: true // OTP sudah diverifikasi di awal
        })

        results.push({
          index: i,
          success: true,
          ...result
        })
        successCount++

      } catch (err: any) {
        logger.error(`[requestBulkWithdraw] Item ${i} failed:`, err)
        results.push({
          index: i,
          success: false,
          error: err.message || 'Processing failed'
        })
        failCount++
      }
    }

    // 5) Invalidate cache
    const { cacheDelPattern } = await import('../core/redis')
    await Promise.all([
      cacheDelPattern(`withdrawals:*`),
      cacheDelPattern(`submerchants:*`),
      cacheDelPattern(`dashboard:${clientUserId}:*`)
    ]).catch(err => logger.error('[requestBulkWithdraw] Cache invalidation failed:', err))

    // 6) Return result
    return res.status(201).json({
      bulkId,
      totalRequested: withdrawals.length,
      successful: successCount,
      failed: failCount,
      results
    })

  } catch (err: any) {
    logger.error('[requestBulkWithdraw]', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

/**
 * Helper function untuk memproses single withdrawal
 */
async function processWithdrawal(params: {
  subMerchantId: string
  sourceProvider: 'hilogate' | 'oy' | 'gidi' | 'ing1' | 'piro' | 'genesis'
  account_number: string
  bank_code: string
  account_name_alias?: string
  amount: number
  account_name?: string
  bank_name?: string
  branch_code?: string
  internal_bank_code?: string
  type: 'single' | 'bulk'
  bulk_id?: string
  clientUserId: string
  partnerClientId: string
  skipOtpCheck?: boolean
}) {
  const {
    subMerchantId,
    sourceProvider,
    account_number,
    bank_code,
    account_name_alias,
    amount,
    account_name,
    bank_name,
    branch_code,
    internal_bank_code,
    type,
    bulk_id,
    partnerClientId,
    clientUserId
  } = params

  // Validate against global withdraw limits
  const [minSet, maxSet] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'withdraw_min' } }),
    prisma.setting.findUnique({ where: { key: 'withdraw_max' } })
  ])
  const minVal = parseFloat(minSet?.value ?? '0')
  const maxVal = parseFloat(maxSet?.value ?? '0')
  
  if (!isNaN(minVal) && minVal > 0 && amount < minVal) {
    throw new Error(`Minimum withdraw Rp ${minVal}`)
  }
  if (!isNaN(maxVal) && maxVal > 0 && amount > maxVal) {
    throw new Error(`Maximum withdraw Rp ${maxVal}`)
  }

  // Get sub-merchant credentials
  const sub = await prisma.sub_merchant.findUnique({
    where: { id: subMerchantId },
    select: { credentials: true, provider: true }
  })
  if (!sub) throw new Error('Credentials not found for sub-merchant')

  // Initialize provider client
  let providerCfg: any
  let hilogateClient: HilogateClient | null = null
  let oyClient: OyClient | null = null
  let gidiClient: GidiClient | null = null
  let ingClient: Ing1Client | null = null
  let piroClient: PiroClient | null = null
  let piroCfg: PiroConfig | null = null

  if (sourceProvider === 'hilogate') {
    const raw = sub.credentials as { merchantId: string; secretKey: string; env?: string }
    providerCfg = {
      merchantId: raw.merchantId,
      secretKey: raw.secretKey,
      env: raw.env ?? 'sandbox',
    } as HilogateConfig
    hilogateClient = new HilogateClient(providerCfg)
  } else if (sourceProvider === 'oy') {
    const raw = sub.credentials as { merchantId: string; secretKey: string }
    providerCfg = {
      baseUrl: 'https://partner.oyindonesia.com',
      username: raw.merchantId,
      apiKey: raw.secretKey,
    } as OyConfig
    oyClient = new OyClient(providerCfg)
  } else if (sourceProvider === 'gidi') {
    const raw = sub.credentials as { baseUrl: string; merchantId: string; credentialKey: string }
    providerCfg = {
      baseUrl: raw.baseUrl,
      merchantId: raw.merchantId,
      credentialKey: raw.credentialKey,
    } as GidiDisbursementConfig
    gidiClient = new GidiClient(providerCfg)
  } else if (isPiroVariant(sourceProvider)) {
    const merchant = await prisma.merchant.findFirst({ where: { name: 'piro' } })
    if (!merchant) throw new Error('Internal Piro merchant not found')

    const subs = await getActiveProviders(merchant.id, 'piro', {})
    if (!subs.length) throw new Error('No active Piro credentials today')

    const picked = subs.find((s) => s.id === subMerchantId) ?? subs[0]
    if (!picked) throw new Error('Active Piro credentials not found for sub-merchant')

    piroCfg = picked.config as PiroConfig
    providerCfg = piroCfg
    piroClient = new PiroClient(piroCfg)
  } else {
    const raw = sub.credentials as unknown as Ing1Config
    providerCfg = {
      baseUrl: raw.baseUrl,
      email: raw.email,
      password: raw.password,
      productCode: raw.productCode,
      callbackUrl: raw.callbackUrl,
      permanentToken: raw.permanentToken,
      merchantId: raw.merchantId,
      apiVersion: raw.apiVersion,
    }
    ingClient = new Ing1Client(providerCfg)
  }

  const withdrawRef = `wd-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`

  // Validate account
  let acctHolder: string
  let alias: string
  let bankNameFinal: string
  let branchName = ''
  let bankIdentifier: string | undefined

  if (sourceProvider === 'hilogate') {
    const valid = await hilogateClient!.validateAccount(account_number, bank_code)
    if (valid.status !== 'valid') {
      throw new Error('Akun bank tidak valid')
    }
    acctHolder = valid.account_holder
    alias = account_name_alias || acctHolder
    const banks = await hilogateClient!.getBankCodes()
    const b = banks.find(b => b.code === bank_code)
    if (!b) throw new Error('Bank code tidak dikenal')
    bankNameFinal = b.name
  } else if (sourceProvider === 'gidi') {
    const inq = await gidiClient!.inquiryAccount(bank_code, account_number, Date.now().toString())
    acctHolder = inq.beneficiaryAccountName
    alias = account_name_alias || acctHolder
    bankNameFinal = bank_name || ''
  } else if (sourceProvider === 'oy') {
    acctHolder = account_name || ''
    alias = account_name_alias || acctHolder
    bankNameFinal = bank_name || ''
  } else if (isPiroVariant(sourceProvider)) {
    if (!piroClient || !piroCfg) {
      throw new Error('Missing Piro client configuration')
    }
    const validation = await piroClient.validateBankAccount({
      accountNumber: account_number,
      bankCode: bank_code,
      branchCode: branch_code,
      bankIdentifier: internal_bank_code,
      bankName: bank_name,
    })

    if (!validation.isValid) {
      throw new Error(validation.message || 'Akun bank tidak valid')
    }

    acctHolder = validation.accountName ?? account_name ?? ''
    alias = account_name_alias || acctHolder
    bankNameFinal = validation.bankName ?? bank_name ?? ''
    branchName = validation.branchCode ?? branch_code ?? ''
    bankIdentifier = validation.bankIdentifier ?? internal_bank_code ?? undefined
  } else {
    acctHolder = account_name || ''
    alias = account_name_alias || acctHolder
    bankNameFinal = bank_name || ''
  }

  // Create withdrawal record in transaction
  const wr = await prisma.$transaction(async tx => {
    const pc = await tx.partnerClient.findUniqueOrThrow({
      where: { id: partnerClientId },
      select: { withdrawFeePercent: true, withdrawFeeFlat: true }
    })

    const inAgg = await tx.order.aggregate({
      _sum: { settlementAmount: true },
      where: {
        subMerchantId,
        partnerClientId,
        settlementTime: { not: null }
      }
    })
    const totalIn = inAgg._sum.settlementAmount ?? 0

    const outAgg = await tx.withdrawRequest.aggregate({
      _sum: { netAmount: true, pgFee: true },
      where: {
        subMerchantId,
        partnerClientId,
        status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] }
      }
    })
    const totalOutNet = outAgg._sum.netAmount ?? 0
    const totalOutFee = outAgg._sum.pgFee ?? 0
    const totalOut = totalOutNet + totalOutFee

    const available = totalIn - totalOut

    if (available < 0) {
      throw new Error('WalletNegativeBalance')
    }

    if (amount > available) {
      throw new Error('InsufficientBalance')
    }

    const feePctAmt = (pc.withdrawFeePercent / 100) * amount
    const netAmt = amount - feePctAmt - pc.withdrawFeeFlat

    const w = await tx.withdrawRequest.create({
      data: {
        refId: withdrawRef,
        amount,
        netAmount: netAmt,
        status: DisbursementStatus.PENDING,
        withdrawFeePercent: pc.withdrawFeePercent,
        withdrawFeeFlat: pc.withdrawFeeFlat,
        sourceProvider,
        type,
        bulkId: bulk_id,
        partnerClient: { connect: { id: partnerClientId } },
        subMerchant: { connect: { id: subMerchantId } },
        accountName: acctHolder,
        accountNameAlias: alias,
        accountNumber: account_number,
        bankCode: bank_code,
        bankName: bankNameFinal,
        branchName
      }
    })

    await tx.partnerClient.update({
      where: { id: partnerClientId },
      data: { balance: { decrement: amount } }
    })

    return w
  })

  // Execute provider withdrawal
  try {
    let resp: any

    if (sourceProvider === 'hilogate') {
      resp = await hilogateClient!.createWithdrawal({
        ref_id: wr.refId,
        amount: wr.netAmount,
        currency: 'IDR',
        account_number,
        account_name: wr.accountName,
        account_name_alias: wr.accountNameAlias,
        bank_code,
        bank_name: wr.bankName,
        branch_name: '',
        description: `Withdraw Rp ${wr.netAmount}`
      })
    } else if (sourceProvider === 'gidi') {
      resp = await gidiClient!.createTransfer({
        requestId: `${wr.refId}-r`,
        transactionId: wr.refId,
        channelId: bank_code,
        accountNo: account_number,
        amount: wr.netAmount,
        transferNote: `Withdraw Rp ${wr.netAmount}`,
      })
    } else if (sourceProvider === 'oy') {
      resp = await oyClient!.disburse({
        recipient_bank: bank_code,
        recipient_account: account_number,
        amount: wr.netAmount,
        note: `Withdraw Rp ${wr.netAmount}`,
        partner_trx_id: wr.refId,
        email: 'client@launcx.com',
      })
    }

    // Map status
    const newStatus = sourceProvider === 'hilogate'
      ? (['WAITING', 'PENDING'].includes(resp.status)
        ? DisbursementStatus.PENDING
        : ['COMPLETED', 'SUCCESS'].includes(resp.status)
          ? DisbursementStatus.COMPLETED
          : DisbursementStatus.FAILED)
      : sourceProvider === 'gidi'
        ? (resp.statusTransfer === 'Success'
          ? DisbursementStatus.COMPLETED
          : resp.statusTransfer === 'Failed'
            ? DisbursementStatus.FAILED
            : DisbursementStatus.PENDING)
        : sourceProvider === 'oy'
          ? (resp.status.code === '101'
            ? DisbursementStatus.PENDING
            : resp.status.code === '000'
              ? DisbursementStatus.COMPLETED
              : DisbursementStatus.FAILED)
          : isPiroVariant(sourceProvider)
            ? mapPiroDisbursement(resp.status)
            : mapIng1ToDisbursement(resp.rc, resp.status)

    // Update record
    await prisma.withdrawRequest.update({
      where: { refId: wr.refId },
      data: {
        paymentGatewayId: sourceProvider === 'ing1'
          ? resp.reff ?? null
          : isPiroVariant(sourceProvider)
            ? resp.withdrawalId ?? resp.referenceId ?? null
            : resp.trx_id || resp.trxId || resp.transactionId,
        isTransferProcess: sourceProvider === 'hilogate' ? (resp.is_transfer_process ?? false) : true,
        status: newStatus,
        ...(sourceProvider === 'ing1' && resp?.data?.fee ? { pgFee: parseIng1Number(resp.data.fee) } : {}),
        ...(isPiroVariant(sourceProvider) && resp.feeAmount ? { pgFee: resp.feeAmount } : {}),
      }
    })

    // Refund if failed
    if (newStatus === DisbursementStatus.FAILED) {
      await prisma.partnerClient.update({
        where: { id: partnerClientId },
        data: { balance: { increment: amount } }
      })
      throw new Error(isPiroVariant(sourceProvider) ? resp.message || 'Withdrawal failed' : 'Withdrawal failed')
    }

    return {
      id: wr.id,
      refId: wr.refId,
      status: newStatus
    }

  } catch (err: any) {
    // Rollback on error
    await prisma.$transaction([
      prisma.withdrawRequest.update({
        where: { refId: wr.refId },
        data: { status: DisbursementStatus.FAILED }
      }),
      prisma.partnerClient.update({
        where: { id: partnerClientId },
        data: { balance: { increment: amount } }
      })
    ])
    throw err
  }
}
