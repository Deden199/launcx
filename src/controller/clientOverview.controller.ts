// src/controller/clientOverview.controller.ts
// Optimized business overview endpoint for client dashboard
// Shows end-to-end flow: VA/QRIS → Transactions → Balance → Withdrawal

import { Response } from 'express'
import { prismaReadOnly } from '../core/prisma'
import { ClientAuthRequest } from '../middleware/clientAuth'
import { cacheGet, cacheSet, getTTL } from '../core/redis'
import { ORDER_STATUS } from '../types/orderStatus'
import { DisbursementStatus } from '@prisma/client'

// Channel types
const CHANNEL_TYPES = {
  QRIS: 'QRIS',
  VA_DANARAPAY: 'VA_DANARAPAY',
} as const

// Success statuses for both payment types
const SUCCESS_STATUSES = [
  ORDER_STATUS.SUCCESS,
  ORDER_STATUS.DONE,
  ORDER_STATUS.SETTLED,
  ORDER_STATUS.PAID,
  ORDER_STATUS.LN_SETTLED,
]

interface OverviewSummary {
  // VA metrics
  va: {
    total: number
    pending: number
    success: number
    expired: number
    totalAmount: number
    paidAmount: number
  }
  // QRIS metrics
  qris: {
    total: number
    pending: number
    success: number
    expired: number
    totalAmount: number
    paidAmount: number
  }
  // Balance
  balance: {
    available: number
    pendingSettlement: number
    pendingWithdrawal: number
    totalWithdrawn: number
  }
  // Combined
  totalIncome: number
  recentTransactions: any[]
  recentWithdrawals: any[]
}

/**
 * GET /api/v1/client/overview
 * Optimized business overview with aggregated metrics
 * Uses parallel queries and caching for performance
 */
export async function getClientOverview(req: ClientAuthRequest, res: Response) {
  try {
    // Build cache key
    const dateFrom = req.query.date_from ? String(req.query.date_from) : ''
    const dateTo = req.query.date_to ? String(req.query.date_to) : ''
    const clientIdParam = req.query.clientId ? String(req.query.clientId) : 'all'
    
    const cacheKey = `overview:${req.clientUserId}:${clientIdParam}:${dateFrom}:${dateTo}`
    
    // Check cache first (short TTL for real-time data)
    const cached = await cacheGet<OverviewSummary>(cacheKey)
    if (cached) {
      return res.json({ success: true, data: cached })
    }

    // Load user and get client IDs
    const user = await prismaReadOnly.clientUser.findUnique({
      where: { id: req.clientUserId! },
      include: {
        partnerClient: {
          select: {
            id: true,
            name: true,
            balance: true,
            children: { select: { id: true, name: true, balance: true } }
          }
        }
      }
    })

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }

    const pc = user.partnerClient!
    
    // Determine client IDs to query
    let clientIds: string[]
    if (clientIdParam !== 'all' && clientIdParam) {
      clientIds = [clientIdParam]
    } else if (pc.children.length > 0) {
      clientIds = [pc.id, ...pc.children.map(c => c.id)]
    } else {
      clientIds = [pc.id]
    }

    // Parse date range
    const createdAtFilter: { gte?: Date; lte?: Date } = {}
    if (dateFrom) createdAtFilter.gte = new Date(dateFrom)
    if (dateTo) createdAtFilter.lte = new Date(dateTo)
    const hasDateFilter = !!dateFrom || !!dateTo

    // Base where clause for orders
    const baseOrderWhere = {
      partnerClientId: { in: clientIds },
      ...(hasDateFilter ? { createdAt: createdAtFilter } : {})
    }

    // Execute all queries in parallel for maximum performance
    const [
      vaStats,
      qrisStats,
      withdrawalStats,
      recentVa,
      recentQris,
      recentWithdrawals,
    ] = await Promise.all([
      // VA statistics - grouped by status
      prismaReadOnly.order.groupBy({
        by: ['status'],
        where: {
          ...baseOrderWhere,
          channel: CHANNEL_TYPES.VA_DANARAPAY,
        },
        _count: { id: true },
        _sum: { amount: true, settlementAmount: true },
      }),

      // QRIS statistics - grouped by status  
      prismaReadOnly.order.groupBy({
        by: ['status'],
        where: {
          ...baseOrderWhere,
          channel: CHANNEL_TYPES.QRIS,
        },
        _count: { id: true },
        _sum: { amount: true, settlementAmount: true },
      }),

      // Withdrawal statistics - grouped by status
      prismaReadOnly.withdrawRequest.groupBy({
        by: ['status'],
        where: {
          partnerClientId: { in: clientIds },
          ...(hasDateFilter ? { createdAt: createdAtFilter } : {})
        },
        _sum: { amount: true, netAmount: true },
      }),

      // Recent VA transactions (limit 5)
      prismaReadOnly.order.findMany({
        where: {
          ...baseOrderWhere,
          channel: CHANNEL_TYPES.VA_DANARAPAY,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          amount: true,
          settlementAmount: true,
          status: true,
          createdAt: true,
          providerPayload: true,
        },
      }),

      // Recent QRIS transactions (limit 5)
      prismaReadOnly.order.findMany({
        where: {
          ...baseOrderWhere,
          channel: CHANNEL_TYPES.QRIS,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          amount: true,
          settlementAmount: true,
          status: true,
          rrn: true,
          createdAt: true,
        },
      }),

      // Recent withdrawals (limit 5)
      prismaReadOnly.withdrawRequest.findMany({
        where: {
          partnerClientId: { in: clientIds },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          refId: true,
          amount: true,
          netAmount: true,
          status: true,
          bankName: true,
          accountNumber: true,
          createdAt: true,
        },
      }),
    ])

    // Process VA stats
    const vaMetrics = {
      total: vaStats.reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      pending: vaStats.filter(g => g.status === ORDER_STATUS.PENDING).reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      success: vaStats.filter(g => SUCCESS_STATUSES.includes(g.status as any)).reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      expired: vaStats.filter(g => g.status === ORDER_STATUS.EXPIRED).reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      totalAmount: vaStats.reduce((sum, g) => sum + (g._sum?.amount ?? 0), 0),
      paidAmount: vaStats.filter(g => SUCCESS_STATUSES.includes(g.status as any)).reduce((sum, g) => sum + (g._sum?.settlementAmount ?? g._sum?.amount ?? 0), 0),
    }

    // Process QRIS stats
    const qrisMetrics = {
      total: qrisStats.reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      pending: qrisStats.filter(g => g.status === ORDER_STATUS.PENDING).reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      success: qrisStats.filter(g => SUCCESS_STATUSES.includes(g.status as any)).reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      expired: qrisStats.filter(g => g.status === ORDER_STATUS.EXPIRED).reduce((sum, g) => sum + (g._count?.id ?? 0), 0),
      totalAmount: qrisStats.reduce((sum, g) => sum + (g._sum?.amount ?? 0), 0),
      paidAmount: qrisStats.filter(g => SUCCESS_STATUSES.includes(g.status as any)).reduce((sum, g) => sum + (g._sum?.settlementAmount ?? g._sum?.amount ?? 0), 0),
    }

    // Process withdrawal stats
    const completedWithdrawals = withdrawalStats.filter(g => g.status === DisbursementStatus.COMPLETED).reduce((sum, g) => sum + (g._sum?.amount ?? 0), 0)
    const pendingWithdrawals = withdrawalStats.filter(g => g.status === DisbursementStatus.PENDING).reduce((sum, g) => sum + (g._sum?.amount ?? 0), 0)

    // Calculate available balance
    const parentBal = clientIds.includes(pc.id) ? pc.balance ?? 0 : 0
    const childrenBal = pc.children.filter(c => clientIds.includes(c.id)).reduce((sum, c) => sum + (c.balance ?? 0), 0)
    const availableBalance = parentBal + childrenBal

    // Calculate pending settlement (PAID but not yet settled)
    const pendingSettlement = qrisStats.filter(g => g.status === ORDER_STATUS.PAID).reduce((sum, g) => sum + (g._sum?.amount ?? 0), 0)
      + vaStats.filter(g => g.status === ORDER_STATUS.PAID).reduce((sum, g) => sum + (g._sum?.amount ?? 0), 0)

    // Format recent transactions
    const formattedVa = recentVa.map(tx => {
      const pp = tx.providerPayload as any
      return {
        id: tx.id,
        type: 'VA',
        amount: tx.amount,
        netAmount: tx.settlementAmount ?? tx.amount,
        status: tx.status,
        reference: pp?.va_number ?? tx.id,
        bankName: pp?.bank_code ?? '',
        date: tx.createdAt.toISOString(),
      }
    })

    const formattedQris = recentQris.map(tx => ({
      id: tx.id,
      type: 'QRIS',
      amount: tx.amount,
      netAmount: tx.settlementAmount ?? tx.amount,
      status: tx.status,
      reference: tx.rrn ?? tx.id,
      date: tx.createdAt.toISOString(),
    }))

    // Merge and sort recent transactions
    const mergedRecent = [...formattedVa, ...formattedQris]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5)

    // Format recent withdrawals
    const formattedWithdrawals = recentWithdrawals.map(w => ({
      refId: w.refId,
      amount: w.amount,
      netAmount: w.netAmount ?? w.amount,
      status: w.status,
      bankName: w.bankName,
      accountNumber: w.accountNumber,
      createdAt: w.createdAt.toISOString(),
    }))

    // Build response
    const summary: OverviewSummary = {
      va: vaMetrics,
      qris: qrisMetrics,
      balance: {
        available: availableBalance,
        pendingSettlement,
        pendingWithdrawal: pendingWithdrawals,
        totalWithdrawn: completedWithdrawals,
      },
      totalIncome: vaMetrics.paidAmount + qrisMetrics.paidAmount,
      recentTransactions: mergedRecent,
      recentWithdrawals: formattedWithdrawals,
    }

    // Cache for 60 seconds (real-time data needs short TTL)
    const ttl = getTTL('overview', 60)
    await cacheSet(cacheKey, summary, ttl)

    return res.json({
      success: true,
      data: summary,
      children: pc.children,
    })

  } catch (err: any) {
    console.error('[getClientOverview] Error:', err)
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' })
  }
}
