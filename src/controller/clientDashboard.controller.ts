// src/controllers/clientDashboard.controller.ts

import { Response } from 'express'
import { prisma } from '../core/prisma'
import { DisbursementStatus } from '@prisma/client'
import { ClientAuthRequest } from '../middleware/clientAuth'
import ExcelJS from 'exceljs'
import crypto from 'crypto';
import axios from 'axios';
import { formatDateJakarta } from '../util/time';
import pLimit from 'p-limit' // optional kalau mau throttle paralel, tapi tidak diperlukan

import { retry } from '../utils/retry';
import { CALLBACK_ALLOWED_STATUSES, isCallbackStatusAllowed } from '../utils/callbackStatus';
import { ORDER_STATUS } from '../types/orderStatus';
import { cacheGet, cacheSet, cacheDelPattern, getTTL } from '../core/redis';

const DASHBOARD_STATUSES = [
  ORDER_STATUS.SUCCESS,
  ORDER_STATUS.DONE,
  ORDER_STATUS.SETTLED,
  ORDER_STATUS.PAID,
  ORDER_STATUS.LN_SETTLED,
  ORDER_STATUS.PENDING,      // <<< REVISI: tambahkan biar order PENDING ikut ter-fetch
  ORDER_STATUS.EXPIRED,      // <<< REVISI: tambahkan biar order EXPIRED ikut ter-fetch
  // …tambahkan status lain jika ada…
];



export async function getClientCallbackUrl(req: ClientAuthRequest, res: Response) {
  // Cari clientUser untuk dapatkan partnerClientId
  const user = await prisma.clientUser.findUnique({
    where: { id: req.clientUserId! },
    select: { partnerClientId: true },
  })
  if (!user) {
    return res.status(404).json({ error: 'User tidak ditemukan' })
  }

  // Ambil data callback dari partnerClient
  const partner = await prisma.partnerClient.findUnique({
    where: { id: user.partnerClientId },
    select: { callbackUrl: true, callbackSecret: true },
  })
  if (!partner) {
    return res.status(404).json({ error: 'PartnerClient tidak ditemukan' })
  }

  return res.json({
    callbackUrl:    partner.callbackUrl || '',
    callbackSecret: partner.callbackSecret || '',
  })
}

/**
 * POST /api/v1/client/callback-url
 * Body: { callbackUrl: string }
 * – Update callbackUrl dan hasilkan callbackSecret jika belum ada
 */
export async function updateClientCallbackUrl(req: ClientAuthRequest, res: Response) {
  const { callbackUrl } = req.body

  // Validasi format HTTPS
  if (typeof callbackUrl !== 'string' || !/^https:\/\/.+/.test(callbackUrl)) {
    return res.status(400).json({ error: 'Callback URL harus HTTPS' })
  }

  // Dapatkan partnerClientId
  const user = await prisma.clientUser.findUnique({
    where: { id: req.clientUserId! },
    select: { partnerClientId: true },
  })
  if (!user) {
    return res.status(404).json({ error: 'User tidak ditemukan' })
  }

  // Generate callbackSecret jika terkirim pertama
  const existing = await prisma.partnerClient.findUnique({
    where: { id: user.partnerClientId },
    select: { callbackSecret: true },
  })
  let secret = existing?.callbackSecret
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
  }

  // Simpan callbackUrl & callbackSecret
  const updated = await prisma.partnerClient.update({
    where: { id: user.partnerClientId },
    data: { callbackUrl, callbackSecret: secret },
    select: { callbackUrl: true, callbackSecret: true },
  })

  return res.json({
    callbackUrl:    updated.callbackUrl,
    callbackSecret: updated.callbackSecret,
  })
}
export async function getClientDashboard(req: ClientAuthRequest, res: Response) {
  try {
    // (1) Build cache key
    const cacheKey = `dashboard:${req.clientUserId}:${req.query.clientId || 'all'}:${req.query.date_from || ''}:${req.query.date_to || ''}:${req.query.status || ''}:${req.query.page || '1'}:${req.query.limit || '50'}:${req.query.search || ''}`;

    // (2) Check cache first (30 second TTL)
    const cached = await cacheGet<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // (3) Fetch user data with partnerClient and children in a single query
    const user = await prisma.clientUser.findUnique({
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
                balance: true
              }
            }
          }
        }
      }
    });
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    const pc = user.partnerClient!;

    // (2) Parse date params - DEFAULT to last 7 days for better performance
    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;

    if (req.query.date_from) {
      dateFrom = new Date(String(req.query.date_from));
    } else {
      dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - 7);
      dateFrom.setHours(0, 0, 0, 0);
    }

    if (req.query.date_to) {
      dateTo = new Date(String(req.query.date_to));
    } else {
      dateTo = new Date();
    }

    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    if (dateFrom) createdAtFilter.gte = dateFrom;
    if (dateTo)   createdAtFilter.lte = dateTo;

    // (2b) Parse status filter
    const rawStatus = (req.query as any).status;
    const allowed = DASHBOARD_STATUSES as readonly string[];
    let statuses: string[] = [];

    if (Array.isArray(rawStatus)) {
      statuses = rawStatus
        .map(String)
        .flatMap(s =>
          s === ORDER_STATUS.SUCCESS
            ? [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED]
            : [s],
        )
        .filter(s => allowed.includes(s));
    } else if (typeof rawStatus === 'string' && rawStatus.trim() !== '') {
      statuses = rawStatus
        .split(',')
        .map(s => s.trim())
        .flatMap(s =>
          s === ORDER_STATUS.SUCCESS
            ? [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED]
            : [s],
        )
        .filter(s => allowed.includes(s));
    }

    if (statuses.includes(ORDER_STATUS.PAID) && !statuses.includes(ORDER_STATUS.LN_SETTLED)) {
      statuses.push(ORDER_STATUS.LN_SETTLED);
    }

    if (statuses.length === 0) statuses = [...allowed];

    // (2c) pagination params
    const pageNum = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(100, parseInt(String(req.query.limit || '50'), 10));

    // (2d) search keyword
    const searchStr = typeof req.query.search === 'string'
      ? req.query.search.trim()
      : '';

    // (3) build list of IDs to query
    let clientIds: string[];
    if (typeof req.query.clientId === 'string'
        && req.query.clientId !== 'all'
        && req.query.clientId.trim()) {
      clientIds = [req.query.clientId];
    } else if (pc.children.length > 0) {
      clientIds = [pc.id, ...pc.children.map(c => c.id)];
    } else {
      clientIds = [pc.id];
    }

    // (4) Build base where clause
    const whereOrders: any = {
      partnerClientId: { in: clientIds },
      status: { in: statuses },
      ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
    };

    if (searchStr) {
      whereOrders.OR = [
        { id:       { contains: searchStr, mode: 'insensitive' } },
        { rrn:      { contains: searchStr, mode: 'insensitive' } },
        { playerId: { contains: searchStr, mode: 'insensitive' } },
      ]
    }

    // (5) Execute all queries in parallel - OPTIMIZED with groupBy
    // Build unique status list for metrics (avoid duplicates)
    const metricsStatuses = Array.from(new Set([
      ...statuses,
      ORDER_STATUS.PAID,
      ORDER_STATUS.LN_SETTLED,
      ORDER_STATUS.SUCCESS,
      ORDER_STATUS.DONE,
      ORDER_STATUS.SETTLED
    ]));

    const [
      metricsGrouped,
      orders,
      totalRows
    ] = await Promise.all([
      // Use groupBy to calculate all metrics in a single query
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
      // Transactions
      prisma.order.findMany({
        where: whereOrders,
        orderBy: { createdAt: 'desc' },
        skip: searchStr ? 0 : (pageNum - 1) * pageSize,
        take: searchStr ? undefined : pageSize,
        select: {
          id: true, qrPayload: true, rrn: true, playerId: true,
          amount: true, feeLauncx: true, settlementAmount: true,
          pendingAmount: true, status: true, settlementStatus: true, createdAt: true,
          paymentReceivedTime: true,
          settlementTime: true,
          trxExpirationTime: true,
        }
      }),
      // Count
      prisma.order.count({ where: whereOrders })
    ]);

    // Extract metrics from grouped results
    const totalPending = metricsGrouped
      .filter(g => g.status === ORDER_STATUS.PAID)
      .reduce((sum, g) => sum + (g._sum.pendingAmount ?? 0), 0);

    const totalPaid = metricsGrouped
      .filter(g => [ORDER_STATUS.PAID, ORDER_STATUS.LN_SETTLED].includes(g.status as any))
      .reduce((sum, g) => sum + (g._sum.amount ?? 0), 0);

    const totalSettlement = metricsGrouped
      .filter(g => [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED].includes(g.status as any))
      .reduce((sum, g) => sum + (g._sum.settlementAmount ?? 0), 0);

    const totalAmount = metricsGrouped
      .filter(g => statuses.includes(g.status as any))
      .reduce((sum, g) => sum + (g._sum.amount ?? 0), 0);

    const totalCount = totalRows;

    // (6) Calculate balance
    const parentBal = clientIds.includes(pc.id) ? pc.balance ?? 0 : 0;
    const childrenBal = pc.children
      .filter(c => clientIds.includes(c.id))
      .reduce((sum, c) => sum + (c.balance ?? 0), 0);
    const totalActive = parentBal + childrenBal;

    // (7) Map transactions
    const transactions = orders.map(o => {
      const netSettle = o.status === ORDER_STATUS.PAID
        ? (o.pendingAmount ?? 0)
        : (o.settlementAmount ?? 0);
      return {
        id: o.id,
        date: o.createdAt.toISOString(),
        reference: o.qrPayload ?? '',
        rrn: o.rrn ?? '',
        playerId: o.playerId,
        amount: o.amount,
        feeLauncx: o.feeLauncx ?? 0,
        netSettle,
        settlementStatus: o.settlementStatus ?? '',
        status: o.status === ORDER_STATUS.SETTLED ? ORDER_STATUS.SUCCESS : o.status,
        paymentReceivedTime: o.paymentReceivedTime?.toISOString() ?? '',
        settlementTime: o.settlementTime?.toISOString() ?? '',
        trxExpirationTime: o.trxExpirationTime?.toISOString() ?? '',
      };
    });

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
      children: pc.children
    };

    // (8) Cache the result using TTL from environment (default 180 seconds)
    const ttl = getTTL('dashboard', 180);
    await cacheSet(cacheKey, result, ttl);

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

export async function exportClientTransactions(req: ClientAuthRequest, res: Response) {
  try {
    // 1) load user + children
    const user = await prisma.clientUser.findUnique({
      where: { id: req.clientUserId! },
      include: {
        partnerClient: {
          include: { children: { select: { id: true, name: true } } }
        }
      }
    })
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
    const pc = user.partnerClient!

    // 2) tanggal
    const dateFrom = req.query.date_from ? new Date(String(req.query.date_from)) : undefined
    const dateTo   = req.query.date_to ? new Date(String(req.query.date_to)) : undefined
    const createdAt: any = {}
    if (dateFrom) createdAt.gte = dateFrom
    if (dateTo)   createdAt.lte = dateTo

    // 3) clientIds override
    const isParent = pc.children.length > 0
    let clientIds = isParent
      ? [pc.id, ...pc.children.map(c => c.id)]
      : [pc.id]
    if (typeof req.query.clientId === 'string' && req.query.clientId !== 'all' && req.query.clientId.trim()) {
      clientIds = [String(req.query.clientId)]
    }

    // 4) status filter expansion
    const rawStatus = req.query.status
    const allowed = DASHBOARD_STATUSES as readonly string[]
    let statuses: string[] = []
    if (Array.isArray(rawStatus)) {
      statuses = rawStatus
        .map(String)
        .flatMap(s =>
          s === ORDER_STATUS.SUCCESS
            ? [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED]
            : [s],
        )
        .filter(s => allowed.includes(s))
    } else if (typeof rawStatus === 'string' && rawStatus.trim() !== '') {
      statuses = rawStatus
        .split(',')
        .map(s => s.trim())
        .flatMap(s =>
          s === ORDER_STATUS.SUCCESS
            ? [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED]
            : [s],
        )
        .filter(s => allowed.includes(s))
    }
    if (statuses.includes(ORDER_STATUS.PAID) && !statuses.includes(ORDER_STATUS.LN_SETTLED)) {
      statuses.push(ORDER_STATUS.LN_SETTLED)
    }
    if (statuses.length === 0) statuses = [...allowed]
    const statusWhere = { in: statuses }

    // 5) id->name map
    const idToName: Record<string,string> = {}
    pc.children.forEach(c => { idToName[c.id] = c.name })
    idToName[pc.id] = pc.name

    // 6) headers
    res.setHeader('Content-Disposition', 'attachment; filename=client-transactions.xlsx')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    // 7) streaming workbook
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: false,
      useSharedStrings: true,
    })

    const all = wb.addWorksheet('All Transactions')
    all.columns = [
      { header: 'Child Name', key: 'name',     width: 30 },
      { header: 'Order ID',   key: 'id',       width: 36 },
      { header: 'RRN',        key: 'rrn',      width: 24 },
      { header: 'Player ID',  key: 'player',   width: 20 },
      { header: 'Amount',     key: 'amt',      width: 15 },
      { header: 'Pending',    key: 'pend',     width: 15 },
      { header: 'Settled',    key: 'sett',     width: 15 },
      { header: 'Fee',        key: 'fee',      width: 15 },
      { header: 'Status',     key: 'stat',     width: 16 },
      { header: 'Date',       key: 'date',     width: 20 },
      { header: 'Update At',    key: 'paidAt',    width: 20 },
      { header: 'Settled At', key: 'settledAt', width: 20 },
      { header: 'Expires At', key: 'expiresAt', width: 20 },
    ]

    // 8) offset-based chunked fetch & write
    const CHUNK_SIZE = 1000
    let skipped = 0

    while (true) {
      const batch = await prisma.order.findMany({
        where: {
          partnerClientId: { in: clientIds },
          status: statusWhere,
          ...(dateFrom || dateTo ? { createdAt } : {}),
        },
        orderBy: { createdAt: 'desc' as const },
        take: CHUNK_SIZE,
        skip: skipped,
        select: {
          partnerClientId:  true,
          id:               true,
          rrn:              true,
          playerId:         true,
          amount:           true,
          pendingAmount:    true,
          settlementAmount: true,
          feeLauncx:        true,
          status:           true,
          createdAt:        true,
          paymentReceivedTime: true,
          settlementTime:      true,
          trxExpirationTime:   true,
        }
      })

      if (batch.length === 0) break

      for (const o of batch) {
        all.addRow({
          name:     idToName[o.partnerClientId] || o.partnerClientId,
          id:       o.id,
          rrn:      o.rrn ?? '',
          player:   o.playerId,
          amt:      o.amount,
          pend:     o.pendingAmount ?? 0,
          sett:     o.settlementAmount ?? 0,
          fee:      o.feeLauncx ?? 0,
          stat:     o.status === ORDER_STATUS.SETTLED ? ORDER_STATUS.SUCCESS : o.status,
          date:     formatDateJakarta(o.createdAt),
          paidAt:    o.paymentReceivedTime ? formatDateJakarta(o.paymentReceivedTime) : '',
          settledAt: o.settlementTime      ? formatDateJakarta(o.settlementTime)      : '',
          expiresAt: o.trxExpirationTime   ? formatDateJakarta(o.trxExpirationTime)   : '',
        }).commit()
      }

      skipped += batch.length
    }

    // 9) finalize workbook
    await all.commit()
    await wb.commit()
    res.end()
  } catch (err: any) {
    console.error('[exportClientTransactions]', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export data' })
    } else {
      try { res.end() } catch {}
    }
  }
}

export async function retryTransactionCallback(
  req: ClientAuthRequest,
  res: Response
) {
  const orderId = req.params.id;
  if (!orderId) {
    return res.status(400).json({ error: 'Missing orderId' });
  }

  // 1) Load Order sebagai source of truth
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      partnerClientId: true,
      status: true,
    }
  });
  if (!order) {
    return res.status(404).json({ error: 'Order tidak ditemukan' });
  }
  if (!isCallbackStatusAllowed(order.status)) {
    return res
      .status(400)
      .json({ error: `Status ${order.status} tidak bisa retry callback` });
  }

  // 2) Verifikasi hak akses
  const allowed = [req.partnerClientId!, ...(req.childrenIds ?? [])];
  if (!allowed.includes(order.partnerClientId!)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // 3) Load konfigurasi callback partner
  const partner = await prisma.partnerClient.findUnique({
    where: { id: order.partnerClientId },
    select: { callbackUrl: true, callbackSecret: true }
  });
  if (!partner?.callbackUrl || !partner.callbackSecret) {
    return res.status(400).json({ error: 'Callback belum diset' });
  }

  // 4) Ambil 1 job terbaru matching payload.orderId via aggregateRaw dan cast ke array
  const rawJobs = await prisma.callbackJob.aggregateRaw({
    pipeline: [
      { $match: { 'payload.orderId': orderId } },
      { $sort: { createdAt: -1 } },
      { $limit: 1 }
    ]
  });
  const jobs = (rawJobs as unknown as any[]);
  const job = jobs[0];
  if (!job) {
    return res.status(404).json({ error: 'Callback job tidak ditemukan' });
  }

  // 5) Kirim ulang dengan retry util
  try {
    await retry(() =>
      axios.post(job.url, job.payload, {
        headers: { 'X-Callback-Signature': job.signature },
        timeout: 5000
      })
    );
    return res.json({ success: true });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: err.message || 'Gagal mengirim callback' });
  }
}
