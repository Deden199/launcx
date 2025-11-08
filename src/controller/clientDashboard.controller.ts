// src/controllers/clientDashboard.controller.ts
/**
 * CLIENT DASHBOARD CONTROLLER - FIXED VERSION
 * 
 * FIXES:
 * 1. Safe settlementTime handling with fallback
 * 2. Proper date parsing for MongoDB mixed formats
 * 3. Consistent balance calculation
 * 4. Fixed JsonObject to any[] type conversion
 */

import { Response } from 'express'
import { prisma, prismaReadOnly } from '../core/prisma'
import { DisbursementStatus } from '@prisma/client'
import { ClientAuthRequest } from '../middleware/clientAuth'
import ExcelJS from 'exceljs'
import crypto from 'crypto'
import axios from 'axios'
import { formatDateJakarta } from '../util/time'
import { retry } from '../utils/retry'
import { isCallbackStatusAllowed } from '../utils/callbackStatus'
import { ORDER_STATUS } from '../types/orderStatus'
import { cacheGet, cacheSet, getTTL } from '../core/redis'

const DASHBOARD_STATUSES = [
  ORDER_STATUS.SUCCESS,
  ORDER_STATUS.DONE,
  ORDER_STATUS.SETTLED,
  ORDER_STATUS.PAID,
  ORDER_STATUS.LN_SETTLED,
  ORDER_STATUS.PENDING,
  ORDER_STATUS.EXPIRED,
]

// ✅ HELPER: Safe date parser untuk handle mixed MongoDB formats
const parseSettlementTime = (value: any): Date | null => {
  if (!value) return null
  
  try {
    // Format 1: Already a Date object
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value
    }
    
    // Format 2: MongoDB $date object
    if (typeof value === 'object' && value.$date) {
      if (typeof value.$date === 'string') {
        const date = new Date(value.$date)
        return isNaN(date.getTime()) ? null : date
      }
      if (typeof value.$date === 'object' && value.$date.$numberLong) {
        const date = new Date(Number(value.$date.$numberLong))
        return isNaN(date.getTime()) ? null : date
      }
    }
    
    // Format 3: ISO string
    if (typeof value === 'string') {
      const date = new Date(value)
      return isNaN(date.getTime()) ? null : date
    }
    
    // Format 4: Unix timestamp
    if (typeof value === 'number') {
      const date = new Date(value)
      return isNaN(date.getTime()) ? null : date
    }
    
    return null
  } catch {
    return null
  }
}

export async function getClientCallbackUrl(req: ClientAuthRequest, res: Response) {
  const user = await prisma.clientUser.findUnique({
    where: { id: req.clientUserId! },
    select: { partnerClientId: true },
  })
  if (!user) {
    return res.status(404).json({ error: 'User tidak ditemukan' })
  }

  const partner = await prisma.partnerClient.findUnique({
    where: { id: user.partnerClientId },
    select: { callbackUrl: true, callbackSecret: true },
  })
  if (!partner) {
    return res.status(404).json({ error: 'PartnerClient tidak ditemukan' })
  }

  return res.json({
    callbackUrl: partner.callbackUrl || '',
    callbackSecret: partner.callbackSecret || '',
  })
}

export async function updateClientCallbackUrl(req: ClientAuthRequest, res: Response) {
  const { callbackUrl } = req.body

  if (typeof callbackUrl !== 'string' || !/^https:\/\/.+/.test(callbackUrl)) {
    return res.status(400).json({ error: 'Callback URL harus HTTPS' })
  }

  const user = await prisma.clientUser.findUnique({
    where: { id: req.clientUserId! },
    select: { partnerClientId: true },
  })
  if (!user) {
    return res.status(404).json({ error: 'User tidak ditemukan' })
  }

  const existing = await prisma.partnerClient.findUnique({
    where: { id: user.partnerClientId },
    select: { callbackSecret: true },
  })
  let secret = existing?.callbackSecret
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
  }

  const updated = await prisma.partnerClient.update({
    where: { id: user.partnerClientId },
    data: { callbackUrl, callbackSecret: secret },
    select: { callbackUrl: true, callbackSecret: true },
  })

  return res.json({
    callbackUrl: updated.callbackUrl,
    callbackSecret: updated.callbackSecret,
  })
}

export async function getClientDashboard(req: ClientAuthRequest, res: Response) {
  try {
    // (1) Build cache key
    const cacheKey = `dashboard:${req.clientUserId}:${req.query.clientId || 'all'}:${req.query.date_from || ''}:${req.query.date_to || ''}:${req.query.status || ''}:${req.query.page || '1'}:${req.query.limit || '50'}:${req.query.search || ''}`

    // (2) Check cache
    const cached = await cacheGet<any>(cacheKey)
    if (cached) {
      return res.json(cached)
    }

    // (3) Load user + partnerClient(+children)
    const user = await prismaReadOnly.clientUser.findUnique({
      where: { id: req.clientUserId! },
      include: {
        partnerClient: {
          select: {
            id: true,
            name: true,
            balance: true,
            children: {
              select: {
                id: true,
                name: true,
                balance: true,
              },
            },
          },
        },
      },
    })

    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
    const pc = user.partnerClient!

    // (4) Date params (default last 7 days)
    let dateFrom: Date
    let dateTo: Date

    dateFrom = req.query.date_from ? new Date(String(req.query.date_from)) : new Date()
    if (!req.query.date_from) {
      dateFrom.setDate(dateFrom.getDate() - 7)
      dateFrom.setHours(0, 0, 0, 0)
    }

    dateTo = req.query.date_to ? new Date(String(req.query.date_to)) : new Date()

    const createdAtFilter: { gte?: Date; lte?: Date } = {}
    if (dateFrom) createdAtFilter.gte = dateFrom
    if (dateTo) createdAtFilter.lte = dateTo

    // (5) Status filter
    const rawStatus = (req.query as any).status
    const allowed = DASHBOARD_STATUSES as readonly string[]
    let statuses: string[] = []

    if (Array.isArray(rawStatus)) {
      statuses = rawStatus
        .map(String)
        .flatMap((s) =>
          s === ORDER_STATUS.SUCCESS
            ? [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED]
            : [s]
        )
        .filter((s) => allowed.includes(s))
    } else if (typeof rawStatus === 'string' && rawStatus.trim() !== '') {
      statuses = rawStatus
        .split(',')
        .map((s) => s.trim())
        .flatMap((s) =>
          s === ORDER_STATUS.SUCCESS
            ? [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED]
            : [s]
        )
        .filter((s) => allowed.includes(s))
    }

    if (statuses.includes(ORDER_STATUS.PAID) && !statuses.includes(ORDER_STATUS.LN_SETTLED)) {
      statuses.push(ORDER_STATUS.LN_SETTLED)
    }

    if (statuses.length === 0) statuses = [...allowed]

    // (6) Pagination + search
    const pageNum = Math.max(1, parseInt(String(req.query.page || '1'), 10))
    const pageSize = Math.min(50, parseInt(String(req.query.limit || '25'), 10))

    const searchStr = typeof req.query.search === 'string' ? req.query.search.trim() : ''

    // (7) Client IDs
    let clientIds: string[]
    if (
      typeof req.query.clientId === 'string' &&
      req.query.clientId !== 'all' &&
      req.query.clientId.trim()
    ) {
      clientIds = [req.query.clientId]
    } else if (pc.children.length > 0) {
      clientIds = [pc.id, ...pc.children.map((c) => c.id)]
    } else {
      clientIds = [pc.id]
    }

    // (8) where clause
    const whereOrders: any = {
      partnerClientId: { in: clientIds },
      status: { in: statuses },
      ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {}),
    }

    if (searchStr) {
      whereOrders.OR = [
        { id: { contains: searchStr, mode: 'insensitive' } },
        { rrn: { contains: searchStr, mode: 'insensitive' } },
        { playerId: { contains: searchStr, mode: 'insensitive' } },
      ]
    }

    // (9) Metrics statuses
    const metricsStatuses = Array.from(
      new Set([
        ...statuses,
        ORDER_STATUS.PAID,
        ORDER_STATUS.LN_SETTLED,
        ORDER_STATUS.SUCCESS,
        ORDER_STATUS.DONE,
        ORDER_STATUS.SETTLED,
      ])
    )

    // (10) Parallel queries (metrics + list + count)
    const [
      metricsGrouped,
      orders,
      totalRows
    ] = await Promise.all([
      prisma.order.groupBy({
        by: ['status'],
        where: {
          partnerClientId: { in: clientIds },
          status: { in: metricsStatuses },
          ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
        },
        _sum: {
          amount: true,
          settlementAmount: true,
          pendingAmount: true
        }
      }),
      // IMPORTANT: HINDARI decode error -> JANGAN select settlementTime di dashboard
      prisma.order.findMany({
        where: whereOrders,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          qrPayload: true,
          rrn: true,
          playerId: true,
          amount: true,
          feeLauncx: true,
          settlementAmount: true,
          pendingAmount: true,
          status: true,
          settlementStatus: true,
          createdAt: true,
          paymentReceivedTime: true,
          trxExpirationTime: true,
          // ❌ DON'T select settlementTime here - fetch separately if needed
        },
      }),
      prisma.order.count({ where: whereOrders })
    ]);

    // (11) Metrics extraction
    const totalPending = metricsGrouped
      .filter(g => g.status === ORDER_STATUS.PAID)
      .reduce((sum, g) => sum + (g._sum.pendingAmount ?? 0), 0);

    const totalPaid = metricsWithExpired
      .filter((g) => [ORDER_STATUS.PAID, ORDER_STATUS.LN_SETTLED].includes(g.status as any))
      .reduce((sum, g) => sum + (g._sum.amount ?? 0), 0)

    const totalSettlement = metricsWithExpired
      .filter((g) => [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED].includes(g.status as any))
      .reduce((sum, g) => sum + (g._sum.settlementAmount ?? 0), 0)

    const totalAmount = metricsWithExpired
      .filter((g) => statuses.includes(g.status as any) && g.status !== ORDER_STATUS.EXPIRED)
      .reduce((sum, g) => sum + (g._sum.amount ?? 0), 0)

    const totalCount = totalRows

    // (13) Balance - SAMA dengan wallet calculation
    const parentBal = clientIds.includes(pc.id) ? pc.balance ?? 0 : 0
    const childrenBal = pc.children
      .filter((c) => clientIds.includes(c.id))
      .reduce((sum, c) => sum + (c.balance ?? 0), 0)
    const totalActive = parentBal + childrenBal

    // (14) Map transactions
    const transactions = orders.map((o) => {
      let status = o.status
      let settlementStatus = o.settlementStatus ?? ''

      if (o.trxExpirationTime && new Date(o.trxExpirationTime) < now && status === ORDER_STATUS.PENDING) {
        status = ORDER_STATUS.EXPIRED
      } else if (settlementStatus === 'SUCCESS') {
        status = ORDER_STATUS.PAID
      }

      const netSettle =
        status === ORDER_STATUS.EXPIRED
          ? 0
          : settlementStatus === 'SUCCESS'
            ? o.settlementAmount ?? 0
            : status === ORDER_STATUS.PAID
              ? o.pendingAmount ?? 0
              : 0

      return {
        id: o.id,
        date: o.createdAt.toISOString(),
        reference: o.qrPayload ?? '',
        rrn: o.rrn ?? '',
        playerId: o.playerId,
        amount: o.amount,
        feeLauncx: o.feeLauncx ?? 0,
        netSettle,
        settlementStatus,
        status: status === ORDER_STATUS.SETTLED ? ORDER_STATUS.SUCCESS : status,
        paymentReceivedTime: o.paymentReceivedTime?.toISOString() ?? '',
        settlementTime: '', // Will be empty, fetch separately if needed
        trxExpirationTime: o.trxExpirationTime?.toISOString() ?? '',
      }
    })

    const result = {
      balance: totalActive,
      totalPending,
      totalAmount,
      totalCount,
      totalSettlement,
      totalPaid,
      totalTransaksi: totalCount,
      total: totalCount,
      transactions,
      children: pc.children,
    }

    // (15) Cache
    const ttl = getTTL('dashboard', 180)
    await cacheSet(cacheKey, result, ttl)

    return res.json(result)
  } catch (err: any) {
    console.error('Error in getClientDashboard:', err)
    return res.status(500).json({ error: err.message || 'Internal Server Error' })
  }
}

export async function exportClientTransactions(req: ClientAuthRequest, res: Response) {
  try {
    // 1) load user + children
    const user = await prisma.clientUser.findUnique({
      where: { id: req.clientUserId! },
      include: {
        partnerClient: {
          include: { children: { select: { id: true, name: true } } },
        },
      },
    })
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })

    const pc = user.partnerClient!

    const dateFrom = req.query.date_from ? new Date(String(req.query.date_from)) : undefined
    const dateTo = req.query.date_to ? new Date(String(req.query.date_to)) : undefined

    const isParent = pc.children.length > 0
    let clientIds: string[] = isParent ? [pc.id, ...pc.children.map((c) => c.id)] : [pc.id]

    const queryClientId = req.query.clientId
    if (typeof queryClientId === 'string' && queryClientId !== 'all' && queryClientId.trim()) {
      clientIds = [queryClientId]
    }

    const rawStatus = req.query.status
    const allowed = DASHBOARD_STATUSES as readonly string[]
    let statuses: string[] = []

    if (Array.isArray(rawStatus)) {
      statuses = rawStatus
        .map((s) => String(s))
        .flatMap((s) =>
          s === ORDER_STATUS.SUCCESS
            ? [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED]
            : [s]
        )
        .filter((s) => allowed.includes(s))
    } else if (typeof rawStatus === 'string' && rawStatus.trim() !== '') {
      statuses = rawStatus
        .split(',')
        .map((s) => s.trim())
        .flatMap((s) =>
          s === ORDER_STATUS.SUCCESS
            ? [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED]
            : [s]
        )
        .filter((s) => allowed.includes(s))
    }

    if (statuses.includes(ORDER_STATUS.PAID) && !statuses.includes(ORDER_STATUS.LN_SETTLED)) {
      statuses.push(ORDER_STATUS.LN_SETTLED)
    }
    if (statuses.length === 0) statuses = [...allowed]

    const idToName: Record<string, string> = {}
    pc.children.forEach((c) => {
      idToName[c.id] = c.name
    })
    idToName[pc.id] = pc.name

    res.setHeader('Content-Disposition', 'attachment; filename=client-transactions.xlsx')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: false,
      useSharedStrings: true,
    })

    const sheet = wb.addWorksheet('All Transactions')
    sheet.columns = [
      { header: 'Child Name', key: 'name', width: 30 },
      { header: 'Order ID', key: 'id', width: 36 },
      { header: 'RRN', key: 'rrn', width: 24 },
      { header: 'Player ID', key: 'player', width: 20 },
      { header: 'Amount', key: 'amt', width: 15 },
      { header: 'Pending', key: 'pend', width: 15 },
      { header: 'Settled', key: 'sett', width: 15 },
      { header: 'Fee', key: 'fee', width: 15 },
      { header: 'Status', key: 'stat', width: 16 },
      { header: 'Date', key: 'date', width: 20 },
      { header: 'Update At', key: 'paidAt', width: 20 },
      { header: 'Settled At', key: 'settledAt', width: 20 },
      { header: 'Expires At', key: 'expiresAt', width: 20 },
    ]

    const CHUNK_SIZE = 500
    let skipped = 0
    let totalRows = 0

    while (true) {
      const raw = await prismaReadOnly.order.aggregateRaw({
        pipeline: [
          {
            $match: {
              partnerClientId: { $in: clientIds },
              status: { $in: statuses },
              ...(dateFrom || dateTo
                ? {
                    createdAt: {
                      ...(dateFrom ? { $gte: { $date: dateFrom.toISOString() } } : {}),
                      ...(dateTo ? { $lte: { $date: dateTo.toISOString() } } : {}),
                    },
                  }
                : {}),
            },
          },
          { $sort: { createdAt: -1 } },
          { $skip: skipped },
          { $limit: CHUNK_SIZE },
          {
            $project: {
              _id: 0,
              partnerClientId: 1,
              id: { $toString: '$_id' },
              rrn: 1,
              playerId: 1,
              amount: 1,
              pendingAmount: 1,
              settlementAmount: 1,
              feeLauncx: 1,
              status: 1,
              createdAt: 1,
              paymentReceivedTime: 1,
              settlementTime: 1, // ✅ Safe to include in aggregateRaw
              trxExpirationTime: 1,
            },
          },
        ],
      })

      // ✅ FIXED TYPE CONVERSION
      const batch = Array.isArray(raw) ? (raw as any[]) : []
      if (batch.length === 0) break

      const now = new Date()

      for (const d of batch) {
        let status = d.status
        const expTime = parseSettlementTime(d.trxExpirationTime)
        const isSettled = [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED].includes(status)

        if (status === ORDER_STATUS.PENDING && expTime && expTime < now) {
          status = ORDER_STATUS.EXPIRED
        }

        sheet
          .addRow({
            name: idToName[String(d.partnerClientId)] || String(d.partnerClientId),
            id: String(d.id),
            rrn: d.rrn ? String(d.rrn) : '',
            player: String(d.playerId),
            amt: Number(d.amount ?? 0),
            pend: status === ORDER_STATUS.PENDING ? Number(d.pendingAmount ?? d.amount ?? 0) : 0,
            sett: isSettled ? Number(d.settlementAmount ?? 0) : 0,
            fee: Number(d.feeLauncx ?? 0),
            stat: isSettled ? ORDER_STATUS.SUCCESS : status,
            date: formatDateJakarta(parseSettlementTime(d.createdAt) ?? new Date()),
            paidAt: d.paymentReceivedTime
              ? formatDateJakarta(parseSettlementTime(d.paymentReceivedTime)!)
              : '',
            settledAt: d.settlementTime ? formatDateJakarta(parseSettlementTime(d.settlementTime)!) : '',
            expiresAt: d.trxExpirationTime
              ? formatDateJakarta(parseSettlementTime(d.trxExpirationTime)!)
              : '',
          })
          .commit()
      }

      skipped += batch.length
      totalRows += batch.length
    }

    console.log(`[Export] Completed: ${totalRows} rows`)
    await sheet.commit()
    await wb.commit()
    res.end()
  } catch (err: any) {
    console.error('[exportClientTransactions]', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export data' })
    } else {
      try {
        res.end()
      } catch {}
    }
  }
}

export async function retryTransactionCallback(req: ClientAuthRequest, res: Response) {
  const orderId = req.params.id
  if (!orderId) {
    return res.status(400).json({ error: 'Missing orderId' })
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      partnerClientId: true,
      status: true,
      partnerClient: {
        select: { callbackUrl: true, callbackSecret: true },
      },
    },
  })
  if (!order) {
    return res.status(404).json({ error: 'Order tidak ditemukan' })
  }
  if (!isCallbackStatusAllowed(order.status)) {
    return res.status(400).json({ error: `Status ${order.status} tidak bisa retry callback` })
  }

  const allowed = [req.partnerClientId!, ...(req.childrenIds ?? [])]
  if (!allowed.includes(order.partnerClientId!)) {
    return res.status(403).json({ error: 'Access denied' })
  }

  if (!order.partnerClient?.callbackUrl || !order.partnerClient.callbackSecret) {
    return res.status(400).json({ error: 'Callback belum diset' })
  }

  const rawJobs = await prisma.callbackJob.aggregateRaw({
    pipeline: [{ $match: { 'payload.orderId': orderId } }, { $sort: { createdAt: -1 } }, { $limit: 1 }],
  })
  
  // ✅ FIXED TYPE CONVERSION
  const jobs = Array.isArray(rawJobs) ? (rawJobs as any[]) : []
  const job = jobs[0]
  if (!job) {
    return res.status(404).json({ error: 'Callback job tidak ditemukan' })
  }

  try {
    await retry(() =>
      axios.post(job.url, job.payload, {
        headers: { 'X-Callback-Signature': job.signature },
        timeout: 5000,
      })
    )
    return res.json({ success: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Gagal mengirim callback' })
  }
}