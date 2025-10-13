import cron from 'node-cron'
import moment from 'moment-timezone'
import { prisma } from '../core/prisma'
import { config } from '../config'
import { formatDateJakarta } from '../util/time'
import { formatIdr } from '../util/currency'
import axios from 'axios'
import { getParentClientsWithChildren } from '../service/partnerClient'
import logger from '../logger'
import { sendTelegramMessage } from '../core/telegram.axios'

const DisbursementStatus = {
  COMPLETED: 'COMPLETED',
  PENDING: 'PENDING'
} as const

export async function buildSummaryMessage(): Promise<string[]> {
  const nowJakarta  = moment().tz('Asia/Jakarta')
  const startOfDay  = nowJakarta.clone().startOf('day').toDate()
  const startOfMonth = nowJakarta.clone().startOf('month').toDate()
  const now         = nowJakarta.toDate()

  const successStatuses = ['PAID', 'DONE', 'SETTLED', 'SUCCESS'] as const

  // OPTIMIZED: Use groupBy to reduce queries from 4 to 1 for order metrics
  const [orderMetrics, pendingAgg, wdAgg, inAgg, outAgg] = await Promise.all([
    // Group orders by status and date range in a single query
    prisma.order.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: startOfDay, lte: now },
        status: { in: [...successStatuses, 'PAID', 'SUCCESS', 'DONE', 'SETTLED'] }
      },
      _sum: {
        amount: true,
        settlementAmount: true,
        pendingAmount: true
      }
    }),
    // Pending from previous days - separate query needed due to different date range
    prisma.order.aggregate({
      _sum: { pendingAmount: true },
      where: {
        createdAt: { gte: startOfMonth, lt: startOfDay },
        status: 'PAID'
      }
    }),
    // Withdrawals
    prisma.withdrawRequest.aggregate({
      _sum: { amount: true },
      where: {
        createdAt: { gte: startOfDay, lte: now },
        status: DisbursementStatus.COMPLETED
      }
    }),
    // Total settled orders
    prisma.order.aggregate({
      _sum: { settlementAmount: true },
      where: { settlementTime: { not: null } }
    }),
    // Total withdrawals
    prisma.withdrawRequest.aggregate({
      _sum: { amount: true },
      where: { status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] } }
    })
  ])

  // Extract metrics from grouped results
  const tpvAmount = orderMetrics
    .filter(g => successStatuses.includes(g.status as any))
    .reduce((sum, g) => sum + (g._sum.amount ?? 0), 0)

  const settleAmount = orderMetrics
    .filter(g => ['SUCCESS', 'DONE', 'SETTLED'].includes(g.status))
    .reduce((sum, g) => sum + (g._sum.settlementAmount ?? 0), 0)

  const paidAmount = orderMetrics
    .filter(g => g.status === 'PAID')
    .reduce((sum, g) => sum + (g._sum.amount ?? 0), 0)

  const totalClientBalance =
    (inAgg._sum.settlementAmount ?? 0) - (outAgg._sum.amount ?? 0)

  const msgLines = [
    `[Dashboard Summary] ${formatDateJakarta(now)}`,
    `Total Payment Volume : ${formatIdr(tpvAmount)}`,
    `Total Paid           : ${formatIdr(paidAmount)}`,
    `Total Settlement     : ${formatIdr(settleAmount)}`,
    `Pending Settlement (Month to Yesterday) : ${formatIdr(pendingAgg._sum.pendingAmount ?? 0)}`,
    `Successful Withdraw  : ${formatIdr(wdAgg._sum.amount ?? 0)}`,
    `Available Client Withdraw : ${formatIdr(totalClientBalance)}`
  ]
  const globalMsg = ['```', ...msgLines, '```'].join('\n')

  const groups = await getParentClientsWithChildren()
  const groupMessages: string[] = []

  for (const parent of groups) {
    if (parent.children.length === 0) continue
    const ids = [parent.id, ...parent.children.map(c => c.id)]

    // OPTIMIZED: Use groupBy for per-group metrics to reduce queries from 4 to 1
    const [gOrderMetrics, gPendingAgg, gWdAgg, gInAgg, gOutAgg] = await Promise.all([
      prisma.order.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: startOfDay, lte: now },
          status: { in: [...successStatuses, 'PAID', 'SUCCESS', 'DONE', 'SETTLED'] },
          partnerClientId: { in: ids }
        },
        _sum: {
          amount: true,
          settlementAmount: true,
          pendingAmount: true
        }
      }),
      prisma.order.aggregate({
        _sum: { pendingAmount: true },
        where: {
          createdAt: { gte: startOfMonth, lt: startOfDay },
          status: 'PAID',
          partnerClientId: { in: ids }
        }
      }),
      prisma.withdrawRequest.aggregate({
        _sum: { amount: true },
        where: {
          createdAt: { gte: startOfDay, lte: now },
          status: DisbursementStatus.COMPLETED,
          partnerClientId: { in: ids }
        }
      }),
      prisma.order.aggregate({
        _sum: { settlementAmount: true },
        where: { settlementTime: { not: null }, partnerClientId: { in: ids } }
      }),
      prisma.withdrawRequest.aggregate({
        _sum: { amount: true },
        where: {
          status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] },
          partnerClientId: { in: ids }
        }
      })
    ])

    const gTpvAmount = gOrderMetrics
      .filter(g => successStatuses.includes(g.status as any))
      .reduce((sum, g) => sum + (g._sum.amount ?? 0), 0)

    const gPaidAmount = gOrderMetrics
      .filter(g => g.status === 'PAID')
      .reduce((sum, g) => sum + (g._sum.amount ?? 0), 0)

    const gSettleAmount = gOrderMetrics
      .filter(g => ['SUCCESS', 'DONE', 'SETTLED'].includes(g.status))
      .reduce((sum, g) => sum + (g._sum.settlementAmount ?? 0), 0)

    const gTotalClientBalance =
      (gInAgg._sum.settlementAmount ?? 0) - (gOutAgg._sum.amount ?? 0)

    const groupLines = [
      `[Dashboard Summary - ${parent.name}] ${formatDateJakarta(now)}`,
      `Total Payment Volume : ${formatIdr(gTpvAmount)}`,
      `Total Paid           : ${formatIdr(gPaidAmount)}`,
      `Total Settlement     : ${formatIdr(gSettleAmount)}`,
      `Pending Settlement (Month to Yesterday) : ${formatIdr(gPendingAgg._sum.pendingAmount ?? 0)}`,
      `Successful Withdraw  : ${formatIdr(gWdAgg._sum.amount ?? 0)}`,
      `Available Client Withdraw : ${formatIdr(gTotalClientBalance)}`
    ]

    groupMessages.push(['```', ...groupLines, '```'].join('\n'))
  }

  return [globalMsg, ...groupMessages]
}

async function sendSummary() {
  try {
    const messages = await buildSummaryMessage()
    const chatId = config.api.telegram.adminChannel
    if (chatId) {
      for (const msg of messages) {
        if (msg.length <= 4096) {
          await axios.post(
            `https://api.telegram.org/bot${config.api.telegram.botToken}/sendMessage`,
            {
              chat_id: chatId,
              text: msg,
              parse_mode: 'Markdown'
            }
          )
        } else {
          for (let i = 0; i < msg.length; i += 4096) {
            const chunk = msg.slice(i, i + 4096)
            await axios.post(
              `https://api.telegram.org/bot${config.api.telegram.botToken}/sendMessage`,
              {
                chat_id: chatId,
                text: chunk,
                parse_mode: 'Markdown'
              }
            )
          }
        }
      }
    }
  } catch (err) {
    logger.error('[dashboardSummary] Unexpected error:', err)
    try {
      if (config.api.telegram.adminChannel) {
        await sendTelegramMessage(
          config.api.telegram.adminChannel,
          `[dashboardSummary] Fatal error: ${err instanceof Error ? err.message : err}`
        )
      }
    } catch (telegramErr) {
      logger.error('[dashboardSummary] Failed to send Telegram alert:', telegramErr)
    }
  }
}

export function scheduleDashboardSummary() {
  const opts = { timezone: 'Asia/Jakarta' as const }
  // Kirim summary tepat di menit ke-0 setiap jam
  cron.schedule('0 * * * *', sendSummary, opts)
}
