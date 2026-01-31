// src/controllers/clientDashboard.controller.ts

import { Response } from 'express'
import { prisma, prismaReadOnly } from '../core/prisma'
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
  ORDER_STATUS.PENDING,
  ORDER_STATUS.EXPIRED,
];

// VA Bank code to name mapping
const VA_BANK_MAP: Record<string, string> = {
  '002': 'BRI',
  '008': 'Mandiri',
  '009': 'BNI',
  '013': 'Permata',
  '022': 'CIMB',
};

// Channel types
const CHANNEL_TYPES = {
  QRIS: 'QRIS',
  VA_DANARAPAY: 'VA_DANARAPAY',
} as const;

// Tipe baris untuk export (dinormalisasi → Date, number, string) agar aman dan teruji.
type OrderExportRow = {
  partnerClientId: string;
  id: string;
  rrn: string | null;
  playerId: string;
  amount: number;
  pendingAmount: number | null;
  settlementAmount: number | null;
  feeLauncx: number | null;
  status: string;
  createdAt: Date;
  paymentReceivedTime: Date | null;
  settlementTime: Date | null;
  trxExpirationTime: Date | null;
};

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
    callbackUrl:    partner.callbackUrl || '',
    callbackSecret: partner.callbackSecret || '',
  })
}

/**
 * POST /api/v1/client/callback-url
 * Body: { callbackUrl: string }
 */
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
    callbackUrl:    updated.callbackUrl,
    callbackSecret: updated.callbackSecret,
  })
}

export async function getClientDashboard(req: ClientAuthRequest, res: Response) {
  try {
    // (1) Parse pagination params - support cursor-based pagination
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
    const pageSize = Math.min(50, parseInt(String(req.query.limit || '20'), 10));

    // (2) Build cache key - include cursor for pagination
    const cacheKey = `dashboard:${req.clientUserId}:${req.query.clientId || 'all'}:${req.query.date_from || ''}:${req.query.date_to || ''}:${req.query.status || ''}:${cursor || 'first'}:${pageSize}:${req.query.search || ''}:${req.query.channel || ''}:${req.query.bankCode || ''}`;

    // (3) Check cache
    const cached = await cacheGet<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // (4) Load user + partnerClient(+children)
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
                balance: true
              }
            }
          }
        }
      }
    });
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    const pc = user.partnerClient!;

    // (5) Date params (default last 7 days)
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

    // (5) Status filter
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

    // (6) Pagination + search
    const pageNum = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(100, parseInt(String(req.query.limit || '50'), 10));

    const searchStr = typeof req.query.search === 'string'
      ? req.query.search.trim()
      : '';

    // (7) Client IDs
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

    // (8) Channel filter (QRIS / VA_DANARAPAY)
    const channelFilter = typeof req.query.channel === 'string' && req.query.channel.trim()
      ? req.query.channel.trim()
      : '';

    // (9) Bank code filter for VA
    const bankCodeFilter = typeof req.query.bankCode === 'string' && req.query.bankCode.trim()
      ? req.query.bankCode.trim()
      : '';

    // (10) where clause for list & count
    const whereOrders: any = {
      partnerClientId: { in: clientIds },
      status: { in: statuses },
      ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
    };

    // Apply channel filter
    if (channelFilter) {
      whereOrders.channel = channelFilter;
    }

    // Apply bank code filter (for VA only - stored in providerPayload.bank_code)
    if (bankCodeFilter && channelFilter === CHANNEL_TYPES.VA_DANARAPAY) {
      whereOrders.providerPayload = {
        path: ['bank_code'],
        equals: bankCodeFilter
      };
    }

    if (searchStr) {
      whereOrders.OR = [
        { id:       { contains: searchStr, mode: 'insensitive' } },
        { rrn:      { contains: searchStr, mode: 'insensitive' } },
        { playerId: { contains: searchStr, mode: 'insensitive' } },
      ]
    }

    // (11) Metrics statuses (unique)
    const metricsStatuses = Array.from(new Set([
      ...statuses,
      ORDER_STATUS.PAID,
      ORDER_STATUS.LN_SETTLED,
      ORDER_STATUS.SUCCESS,
      ORDER_STATUS.DONE,
      ORDER_STATUS.SETTLED
    ]));

    // Build metrics where clause (apply channel filter to metrics too)
    const metricsWhere: any = {
      partnerClientId: { in: clientIds },
      status: { in: metricsStatuses },
      ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
    };
    if (channelFilter) {
      metricsWhere.channel = channelFilter;
    }

    // (12) Parallel queries (metrics + list + count + VA stats)
    const [
      metricsGrouped,
      orders,
      totalRows,
      vaStats
    ] = await Promise.all([
      prismaReadOnly.order.groupBy({
        by: ['status'],
        where: metricsWhere,
        _sum: {
          amount: true,
          settlementAmount: true,
          pendingAmount: true
        }
      }),
      // IMPORTANT: HINDARI decode error -> JANGAN select settlementTime di dashboard
      prismaReadOnly.order.findMany({
        where: whereOrders,
        orderBy: { createdAt: 'desc' },
        skip: searchStr ? 0 : (pageNum - 1) * pageSize,
        take: searchStr ? undefined : pageSize,
        select: {
          id: true, qrPayload: true, rrn: true, playerId: true,
          amount: true, feeLauncx: true, settlementAmount: true,
          pendingAmount: true, status: true, settlementStatus: true, createdAt: true,
          paymentReceivedTime: true,
          channel: true,
          providerPayload: true,
          // settlementTime sengaja tidak di-select agar tidak crash jika ada dokumen bertipe string
          trxExpirationTime: true,
        }
      }),
      prismaReadOnly.order.count({ where: whereOrders }),
      // VA specific stats
      prismaReadOnly.order.groupBy({
        by: ['status'],
        where: {
          partnerClientId: { in: clientIds },
          channel: CHANNEL_TYPES.VA_DANARAPAY,
          ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
        },
        _count: { id: true },
        _sum: { amount: true }
      })
    ]);

    // (13) Metrics extraction
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

    // (14) VA Stats extraction
    const vaStatsMap = {
      created: vaStats.reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      pending: vaStats
        .filter(g => g.status === ORDER_STATUS.PENDING)
        .reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      success: vaStats
        .filter(g => [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED, ORDER_STATUS.PAID, ORDER_STATUS.LN_SETTLED].includes(g.status as any))
        .reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      expired: vaStats
        .filter(g => g.status === ORDER_STATUS.EXPIRED)
        .reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      totalAmount: vaStats.reduce((sum, g) => sum + (g._sum?.amount ?? 0), 0),
    };

    // (15) Balance
    const parentBal = clientIds.includes(pc.id) ? pc.balance ?? 0 : 0;
    const childrenBal = pc.children
      .filter(c => clientIds.includes(c.id))
      .reduce((sum, c) => sum + (c.balance ?? 0), 0);
    const totalActive = parentBal + childrenBal;

    // (16) Map transactions with VA data
    const transactions = orders.map(o => {
      const netSettle = o.status === ORDER_STATUS.PAID
        ? (o.pendingAmount ?? 0)
        : (o.settlementAmount ?? 0);
      
      // Extract VA info from providerPayload
      const pp = o.providerPayload as any;
      const vaNumber = pp?.va_number ?? '';
      const bankCode = pp?.bank_code ?? '';
      const bankName = bankCode ? (VA_BANK_MAP[bankCode] ?? bankCode) : '';
      
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
        settlementTime: '', // sementara kosong agar aman dari decode error
        trxExpirationTime: o.trxExpirationTime?.toISOString() ?? '',
        // VA specific fields
        channel: o.channel || 'QRIS',
        vaNumber,
        bankCode,
        bankName,
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
      children: pc.children,
      // VA Stats
      vaStats: vaStatsMap,
      // Available banks for filter
      vaBanks: Object.entries(VA_BANK_MAP).map(([code, name]) => ({ code, name })),
    };

    // (14) Cache
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
    const user = await prismaReadOnly.clientUser.findUnique({
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
      { header: 'Update At',  key: 'paidAt',   width: 20 },
      { header: 'Settled At', key: 'settledAt', width: 20 },
      { header: 'Expires At', key: 'expiresAt', width: 20 },
    ]

    // 8) Chunked fetch via aggregateRaw + coercion (robust & aman TypeScript)
    const CHUNK_SIZE = 1000
    let skipped = 0

    while (true) {
      const raw = await prismaReadOnly.order.aggregateRaw({
        pipeline: [
          { $match: {
              partnerClientId: { $in: clientIds },
              status: { $in: statuses },
              ...(dateFrom || dateTo ? {
                createdAt: {
                  ...(dateFrom ? { $gte: { $date: dateFrom.toISOString() } } : {}),
                  ...(dateTo   ? { $lte: { $date: dateTo.toISOString() } }   : {}),
                }
              } : {})
          }},
          { $sort: { createdAt: -1 } },
          { $skip: skipped },
          { $limit: CHUNK_SIZE },
          // Coerce string→date bila ada data “nakal”
          { $addFields: {
              settlementTime: {
                $cond: [
                  { $eq: [ { $type: "$settlementTime" }, "string" ] },
                  { $dateFromString: { dateString: "$settlementTime", onError: null, onNull: null } },
                  "$settlementTime"
                ]
              },
              paymentReceivedTime: {
                $cond: [
                  { $eq: [ { $type: "$paymentReceivedTime" }, "string" ] },
                  { $dateFromString: { dateString: "$paymentReceivedTime", onError: null, onNull: null } },
                  "$paymentReceivedTime"
                ]
              },
              trxExpirationTime: {
                $cond: [
                  { $eq: [ { $type: "$trxExpirationTime" }, "string" ] },
                  { $dateFromString: { dateString: "$trxExpirationTime", onError: null, onNull: null } },
                  "$trxExpirationTime"
                ]
              }
          }},
          { $project: {
              _id: 0,
              partnerClientId: 1,
              id: { $toString: "$_id" },
              rrn: 1,
              playerId: 1,
              amount: 1,
              pendingAmount: 1,
              settlementAmount: 1,
              feeLauncx: 1,
              status: 1,
              createdAt: 1,
              paymentReceivedTime: 1,
              settlementTime: 1,
              trxExpirationTime: 1
          }}
        ]
      });

      // Normalisasi aman: JsonObject -> any[] -> OrderExportRow[], tanpa warning TS
      const batch: OrderExportRow[] = (raw as unknown as any[]).map((d) => {
        // Helper function to convert MongoDB date format to JavaScript Date
        const toDate = (val: any): Date | null => {
          if (!val) return null;
          // MongoDB extended JSON format: { $date: "ISO string" } or { $date: { $numberLong: "timestamp" } }
          if (typeof val === 'object' && val.$date) {
            if (typeof val.$date === 'string') {
              return new Date(val.$date);
            } else if (typeof val.$date === 'object' && val.$date.$numberLong) {
              return new Date(Number(val.$date.$numberLong));
            }
          }
          // Regular date string or timestamp
          const date = new Date(val);
          return isNaN(date.getTime()) ? null : date;
        };

        return {
          partnerClientId: String(d.partnerClientId),
          id: String(d.id),
          rrn: d.rrn ?? null,
          playerId: String(d.playerId),
          amount: Number(d.amount ?? 0),
          pendingAmount: d.pendingAmount == null ? null : Number(d.pendingAmount),
          settlementAmount: d.settlementAmount == null ? null : Number(d.settlementAmount),
          feeLauncx: d.feeLauncx == null ? null : Number(d.feeLauncx),
          status: String(d.status),
          createdAt: toDate(d.createdAt) ?? new Date(),
          paymentReceivedTime: toDate(d.paymentReceivedTime),
          settlementTime: toDate(d.settlementTime),
          trxExpirationTime: toDate(d.trxExpirationTime),
        };
      });

      if (batch.length === 0) break;

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

  // 4) Ambil 1 job terbaru matching payload.orderId via aggregateRaw
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


/**
 * GET /api/v1/client/va-active
 * List active VA for monitoring
 */
export async function getActiveVaList(req: ClientAuthRequest, res: Response) {
  try {
    // Load user + partnerClient(+children)
    const user = await prismaReadOnly.clientUser.findUnique({
      where: { id: req.clientUserId! },
      include: {
        partnerClient: {
          select: {
            id: true,
            children: { select: { id: true } }
          }
        }
      }
    });
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    const pc = user.partnerClient!;

    // Client IDs
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

    // Bank filter
    const bankCodeFilter = typeof req.query.bankCode === 'string' && req.query.bankCode.trim()
      ? req.query.bankCode.trim()
      : '';

    // Pagination
    const pageNum = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(50, parseInt(String(req.query.limit || '20'), 10));

    // Query active VAs (PENDING status with VA_DANARAPAY channel)
    const whereVa: any = {
      partnerClientId: { in: clientIds },
      channel: CHANNEL_TYPES.VA_DANARAPAY,
      status: ORDER_STATUS.PENDING,
    };

    if (bankCodeFilter) {
      whereVa.providerPayload = {
        path: ['bank_code'],
        equals: bankCodeFilter
      };
    }

    const [vaList, totalCount] = await Promise.all([
      prismaReadOnly.order.findMany({
        where: whereVa,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          playerId: true,
          amount: true,
          status: true,
          createdAt: true,
          trxExpirationTime: true,
          providerPayload: true,
        }
      }),
      prismaReadOnly.order.count({ where: whereVa })
    ]);

    // Map VA data
    const activeVas = vaList.map(va => {
      const pp = va.providerPayload as any;
      return {
        id: va.id,
        vaNumber: pp?.va_number ?? '',
        bankCode: pp?.bank_code ?? '',
        bankName: pp?.bank_code ? (VA_BANK_MAP[pp.bank_code] ?? pp.bank_code) : '',
        amount: va.amount,
        isOpen: pp?.is_open ?? true,
        playerId: va.playerId ?? '',
        usernameDisplay: pp?.username_display ?? '',
        status: va.status,
        vaStatus: pp?.va_status ?? 'WAITING_PAYMENT',
        createdAt: va.createdAt.toISOString(),
        expiresAt: va.trxExpirationTime?.toISOString() ?? '',
      };
    });

    return res.json({
      success: true,
      data: activeVas,
      total: totalCount,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (err: any) {
    console.error('[getActiveVaList]', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}


/**
 * GET /api/v1/client/va-dashboard
 * Dedicated VA Dashboard - transactions + stats for VA DanaRapay only
 * Optimized with cursor-based pagination for better performance
 */
export async function getVaDashboard(req: ClientAuthRequest, res: Response) {
  try {
    // Load user + partnerClient(+children)
    const user = await prismaReadOnly.clientUser.findUnique({
      where: { id: req.clientUserId! },
      include: {
        partnerClient: {
          select: {
            id: true,
            name: true,
            children: { select: { id: true, name: true } }
          }
        }
      }
    });

    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    const pc = user.partnerClient!;

    // Client IDs
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

    // Parse date range
    const dateFrom = typeof req.query.date_from === 'string' ? new Date(req.query.date_from) : null;
    const dateTo = typeof req.query.date_to === 'string' ? new Date(req.query.date_to) : null;

    const createdAtFilter: any = {};
    if (dateFrom) createdAtFilter.gte = dateFrom;
    if (dateTo) createdAtFilter.lte = dateTo;
    const hasDateFilter = !!dateFrom || !!dateTo;

    // Status filter
    let statuses: string[] = DASHBOARD_STATUSES;
    if (req.query.status) {
      const statusParam = req.query.status;
      if (Array.isArray(statusParam)) {
        statuses = statusParam as string[];
      } else if (typeof statusParam === 'string') {
        statuses = [statusParam];
      }
    }

    // Bank filter
    const bankCodeFilter = typeof req.query.bankCode === 'string' && req.query.bankCode.trim()
      ? req.query.bankCode.trim()
      : '';

    // Search
    const searchStr = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    // Pagination - support both offset and cursor
    const pageSize = Math.min(50, parseInt(String(req.query.limit || '10'), 10));
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
    const pageNum = cursor ? 1 : Math.max(1, parseInt(String(req.query.page || '1'), 10));

    // Base where clause - VA_DANARAPAY only
    const whereVa: any = {
      partnerClientId: { in: clientIds },
      channel: CHANNEL_TYPES.VA_DANARAPAY,
      status: { in: statuses },
      ...(hasDateFilter ? { createdAt: createdAtFilter } : {})
    };

    // Bank filter using JSON path
    if (bankCodeFilter) {
      whereVa.providerPayload = {
        path: ['bank_code'],
        equals: bankCodeFilter
      };
    }

    // Search filter
    if (searchStr) {
      whereVa.OR = [
        { id: { contains: searchStr, mode: 'insensitive' } },
        { playerId: { contains: searchStr, mode: 'insensitive' } },
      ];
    }

    // Build cursor-based query
    const findManyArgs: any = {
      where: whereVa,
      orderBy: { createdAt: 'desc' },
      take: pageSize + 1, // Take one extra to determine hasMore
      select: {
        id: true,
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
        providerPayload: true,
      }
    };

    // Cursor-based pagination (more efficient)
    if (cursor) {
      findManyArgs.cursor = { id: cursor };
      findManyArgs.skip = 1; // Skip the cursor itself
    } else if (!cursor && pageNum > 1) {
      // Fallback to offset for page navigation (less efficient but needed for direct page access)
      findManyArgs.skip = (pageNum - 1) * pageSize;
      findManyArgs.take = pageSize;
    }

    // Parallel queries with optimized stats
    const [transactions, totalCount, statsGrouped] = await Promise.all([
      // Transactions with cursor
      prismaReadOnly.order.findMany(findManyArgs),
      
      // Count only if needed (first page or offset pagination)
      cursor ? Promise.resolve(0) : prismaReadOnly.order.count({ where: whereVa }),
      
      // Stats grouped by status - cached aggregation
      prismaReadOnly.order.groupBy({
        by: ['status'],
        where: {
          partnerClientId: { in: clientIds },
          channel: CHANNEL_TYPES.VA_DANARAPAY,
          ...(hasDateFilter ? { createdAt: createdAtFilter } : {})
        },
        _count: { id: true },
        _sum: { amount: true, settlementAmount: true }
      })
    ]);

    // Determine hasMore and nextCursor
    const hasMore = transactions.length > pageSize;
    const resultTx = hasMore ? transactions.slice(0, -1) : transactions;
    const nextCursor = hasMore ? resultTx[resultTx.length - 1]?.id : null;

    // Calculate stats from grouped data
    const stats = {
      total: statsGrouped.reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      pending: statsGrouped
        .filter(g => g.status === ORDER_STATUS.PENDING)
        .reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      success: statsGrouped
        .filter(g => [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED, ORDER_STATUS.PAID, ORDER_STATUS.LN_SETTLED].includes(g.status as any))
        .reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      expired: statsGrouped
        .filter(g => g.status === ORDER_STATUS.EXPIRED)
        .reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      totalAmount: statsGrouped.reduce((sum, g) => sum + (g._sum?.amount ?? 0), 0),
      totalPaid: statsGrouped
        .filter(g => [ORDER_STATUS.SUCCESS, ORDER_STATUS.DONE, ORDER_STATUS.SETTLED, ORDER_STATUS.PAID, ORDER_STATUS.LN_SETTLED].includes(g.status as any))
        .reduce((sum, g) => sum + (g._sum?.amount ?? 0), 0),
    };

    // Map transactions with minimal transformation
    const mappedTx = resultTx.map(o => {
      const pp = o.providerPayload as any;
      const netSettle = [ORDER_STATUS.PAID].includes(o.status as any)
        ? (o.pendingAmount ?? 0)
        : (o.settlementAmount ?? 0);

      return {
        id: o.id,
        date: o.createdAt.toISOString(),
        vaNumber: pp?.va_number ?? '',
        bankCode: pp?.bank_code ?? '',
        bankName: pp?.bank_code ? (VA_BANK_MAP[pp.bank_code] ?? pp.bank_code) : '',
        playerId: o.playerId ?? '',
        usernameDisplay: pp?.username_display ?? '',
        amount: o.amount,
        feeLauncx: o.feeLauncx ?? 0,
        netSettle,
        status: o.status === ORDER_STATUS.SETTLED ? ORDER_STATUS.SUCCESS : o.status,
        settlementStatus: o.settlementStatus ?? '',
        paymentReceivedTime: o.paymentReceivedTime?.toISOString() ?? '',
        trxExpirationTime: o.trxExpirationTime?.toISOString() ?? '',
      };
    });

    return res.json({
      success: true,
      transactions: mappedTx,
      total: cursor ? stats.total : totalCount, // Use stats.total for cursor mode
      page: pageNum,
      limit: pageSize,
      totalPages: cursor ? null : Math.ceil(totalCount / pageSize),
      // Cursor pagination info
      nextCursor,
      hasMore,
      stats,
      children: pc.children,
    });
  } catch (err: any) {
    console.error('[getVaDashboard]', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

