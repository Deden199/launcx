import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import moment from 'moment-timezone'
import ExcelJS from 'exceljs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ log: ['error'] })

const TZ = 'Asia/Jakarta'
const START_MONTH = '2025-09'
const END_MONTH = '2026-02'
const DATE_TOLERANCE_HOURS = Number(process.env.EXPORT_TOLERANCE_HOURS ?? '14')
const OUTPUT_ROOT = path.resolve(process.cwd(), 'exports', 'sep2025-feb2026-transactions')
const DEPOSIT_STATUSES = ['SUCCESS', 'DONE', 'SETTLED', 'PAID', 'LN_SETTLED', 'PENDING', 'EXPIRED']

const MONTHS = buildMonths(START_MONTH, END_MONTH)

type OrderRow = {
  id: string
  partnerClientId: string
  clientName: string
  createdAt: Date
  monthKey: string
  rrn: string
  playerId: string
  channel: string
  amount: number
  feeLauncx: number
  fee3rdParty: number
  netAmount: number
  status: string
}

type WithdrawRow = {
  id: string
  refId: string
  partnerClientId: string
  clientName: string
  createdAt: Date
  monthKey: string
  bankName: string
  accountNumber: string
  amount: number
  withdrawFee: number
  pgFee: number
  netAmount: number
  status: string
}

function buildMonths(startMonth: string, endMonth: string): string[] {
  const out: string[] = []
  let cursor = moment.tz(`${startMonth}-01 00:00:00`, 'YYYY-MM-DD HH:mm:ss', TZ)
  const end = moment.tz(`${endMonth}-01 00:00:00`, 'YYYY-MM-DD HH:mm:ss', TZ)

  while (cursor.isSameOrBefore(end, 'month')) {
    out.push(cursor.format('YYYY-MM'))
    cursor = cursor.clone().add(1, 'month')
  }

  return out
}

function getMonthWindow(monthKey: string): { exactStart: Date; exactEnd: Date; tolerantStart: Date; tolerantEnd: Date } {
  const start = moment.tz(`${monthKey}-01 00:00:00`, 'YYYY-MM-DD HH:mm:ss', TZ)
  const end = start.clone().endOf('month')

  return {
    exactStart: start.toDate(),
    exactEnd: end.toDate(),
    tolerantStart: start.clone().subtract(DATE_TOLERANCE_HOURS, 'hours').toDate(),
    tolerantEnd: end.clone().add(DATE_TOLERANCE_HOURS, 'hours').toDate(),
  }
}

function toMonthKeyWib(date: Date): string {
  return moment(date).tz(TZ).format('YYYY-MM')
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) || 'client'
}

function csvEscape(value: unknown): string {
  const raw = value == null ? '' : String(value)
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

async function writeCsv(filePath: string, headers: string[], rows: unknown[][]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const content = [headers.map(csvEscape).join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n')
  await fs.writeFile(filePath, content, 'utf8')
}

async function main() {
  const startTs = Date.now()
  await fs.mkdir(OUTPUT_ROOT, { recursive: true })

  const clients = await prisma.partnerClient.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  const clientNameMap = new Map(clients.map(c => [c.id, c.name]))

  const allOrders: OrderRow[] = []
  const allWithdrawals: WithdrawRow[] = []

  for (const monthKey of MONTHS) {
    const window = getMonthWindow(monthKey)

    const [orders, withdrawals] = await Promise.all([
      prisma.order.findMany({
        where: {
          createdAt: { gte: window.tolerantStart, lte: window.tolerantEnd },
          status: { in: DEPOSIT_STATUSES },
          partnerClientId: { not: null },
        },
        select: {
          id: true,
          partnerClientId: true,
          createdAt: true,
          rrn: true,
          playerId: true,
          channel: true,
          amount: true,
          feeLauncx: true,
          fee3rdParty: true,
          settlementAmount: true,
          pendingAmount: true,
          status: true,
          loanEntry: { select: { amount: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.withdrawRequest.findMany({
        where: {
          createdAt: { gte: window.tolerantStart, lte: window.tolerantEnd },
          status: { in: ['PENDING', 'COMPLETED', 'FAILED', 'CREATED'] },
        },
        select: {
          id: true,
          refId: true,
          partnerClientId: true,
          createdAt: true,
          bankName: true,
          accountNumber: true,
          amount: true,
          netAmount: true,
          pgFee: true,
          withdrawFeePercent: true,
          withdrawFeeFlat: true,
          status: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    for (const o of orders) {
      if (!o.partnerClientId) continue
      const actualMonth = toMonthKeyWib(o.createdAt)
      if (actualMonth !== monthKey) continue
      let netAmount = o.settlementAmount ?? 0
      if (o.status === 'PAID') netAmount = o.pendingAmount ?? 0
      if (o.status === 'LN_SETTLED') netAmount = o.loanEntry?.amount ?? 0

      allOrders.push({
        id: o.id,
        partnerClientId: o.partnerClientId,
        clientName: clientNameMap.get(o.partnerClientId) ?? o.partnerClientId,
        createdAt: o.createdAt,
        monthKey,
        rrn: o.rrn ?? '-',
        playerId: o.playerId ?? '-',
        channel: o.channel,
        amount: o.amount,
        feeLauncx: o.feeLauncx ?? 0,
        fee3rdParty: o.fee3rdParty ?? 0,
        netAmount,
        status: o.status,
      })
    }

    for (const w of withdrawals) {
      const actualMonth = toMonthKeyWib(w.createdAt)
      if (actualMonth !== monthKey) continue
      const withdrawFee = w.netAmount != null
        ? w.amount - w.netAmount
        : ((w.withdrawFeePercent ?? 0) / 100) * w.amount + (w.withdrawFeeFlat ?? 0)

      allWithdrawals.push({
        id: w.id,
        refId: w.refId,
        partnerClientId: w.partnerClientId,
        clientName: clientNameMap.get(w.partnerClientId) ?? w.partnerClientId,
        createdAt: w.createdAt,
        monthKey,
        bankName: w.bankName,
        accountNumber: w.accountNumber,
        amount: w.amount,
        withdrawFee,
        pgFee: w.pgFee ?? 0,
        netAmount: w.netAmount ?? (w.amount - withdrawFee),
        status: w.status,
      })
    }

    console.log(`[${monthKey}] deposits=${orders.length}, withdrawals=${withdrawals.length}`)
  }

  allOrders.sort((a, b) => a.monthKey.localeCompare(b.monthKey) || a.clientName.localeCompare(b.clientName) || a.createdAt.getTime() - b.createdAt.getTime())
  allWithdrawals.sort((a, b) => a.monthKey.localeCompare(b.monthKey) || a.clientName.localeCompare(b.clientName) || a.createdAt.getTime() - b.createdAt.getTime())

  await exportAdminWorkbook(allOrders, allWithdrawals)
  await exportClientWorkbook(allOrders, allWithdrawals)
  await exportSplitCsv(allOrders, allWithdrawals)

  const took = ((Date.now() - startTs) / 1000).toFixed(2)
  console.log(`Done. Output: ${OUTPUT_ROOT} | rows: deposits=${allOrders.length}, withdrawals=${allWithdrawals.length} | ${took}s`)
}

async function exportAdminWorkbook(orders: OrderRow[], withdrawals: WithdrawRow[]) {
  const wb = new ExcelJS.Workbook()
  const tx = wb.addWorksheet('Transactions')
  tx.columns = [
    { header: 'Month', key: 'month', width: 10 },
    { header: 'Client Name', key: 'clientName', width: 30 },
    { header: 'Client ID', key: 'clientId', width: 38 },
    { header: 'Date', key: 'date', width: 20 },
    { header: 'TRX ID', key: 'id', width: 38 },
    { header: 'RRN', key: 'rrn', width: 24 },
    { header: 'Player ID', key: 'playerId', width: 20 },
    { header: 'Channel', key: 'channel', width: 16 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Fee Launcx', key: 'feeLauncx', width: 14 },
    { header: 'Fee PG', key: 'feePg', width: 14 },
    { header: 'Net Amount', key: 'net', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
  ]
  for (const o of orders) {
    tx.addRow({
      month: o.monthKey,
      clientName: o.clientName,
      clientId: o.partnerClientId,
      date: moment(o.createdAt).tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
      id: o.id,
      rrn: o.rrn,
      playerId: o.playerId,
      channel: o.channel,
      amount: o.amount,
      feeLauncx: o.feeLauncx,
      feePg: o.fee3rdParty,
      net: o.netAmount,
      status: o.status,
    })
  }

  const wd = wb.addWorksheet('Withdrawals')
  wd.columns = [
    { header: 'Month', key: 'month', width: 10 },
    { header: 'Client Name', key: 'clientName', width: 30 },
    { header: 'Client ID', key: 'clientId', width: 38 },
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Ref ID', key: 'ref', width: 24 },
    { header: 'Bank', key: 'bank', width: 18 },
    { header: 'Account', key: 'account', width: 20 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Withdrawal Fee', key: 'wdFee', width: 14 },
    { header: 'PG Fee', key: 'pgFee', width: 12 },
    { header: 'Net Amount', key: 'net', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
  ]
  for (const w of withdrawals) {
    wd.addRow({
      month: w.monthKey,
      clientName: w.clientName,
      clientId: w.partnerClientId,
      date: moment(w.createdAt).tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
      ref: w.refId,
      bank: w.bankName,
      account: w.accountNumber,
      amount: w.amount,
      wdFee: w.withdrawFee,
      pgFee: w.pgFee,
      net: w.netAmount,
      status: w.status,
    })
  }

  await wb.xlsx.writeFile(path.join(OUTPUT_ROOT, 'admin-export.xlsx'))
}

async function exportClientWorkbook(orders: OrderRow[], withdrawals: WithdrawRow[]) {
  const wb = new ExcelJS.Workbook()
  const tx = wb.addWorksheet('All Transactions')
  tx.columns = [
    { header: 'Month', key: 'month', width: 10 },
    { header: 'Child Name', key: 'name', width: 30 },
    { header: 'Order ID', key: 'id', width: 36 },
    { header: 'RRN', key: 'rrn', width: 24 },
    { header: 'Player ID', key: 'player', width: 20 },
    { header: 'Amount', key: 'amt', width: 15 },
    { header: 'Pending/Net', key: 'net', width: 15 },
    { header: 'Fee', key: 'fee', width: 15 },
    { header: 'Status', key: 'stat', width: 16 },
    { header: 'Date', key: 'date', width: 20 },
  ]

  for (const o of orders) {
    tx.addRow({
      month: o.monthKey,
      name: o.clientName,
      id: o.id,
      rrn: o.rrn,
      player: o.playerId,
      amt: o.amount,
      net: o.netAmount,
      fee: o.feeLauncx,
      stat: o.status,
      date: moment(o.createdAt).tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
    })
  }

  const wd = wb.addWorksheet('Withdrawals')
  wd.columns = [
    { header: 'Month', key: 'month', width: 10 },
    { header: 'Child Name', key: 'name', width: 30 },
    { header: 'Ref ID', key: 'ref', width: 24 },
    { header: 'Bank', key: 'bank', width: 18 },
    { header: 'Account', key: 'account', width: 20 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Fee', key: 'fee', width: 12 },
    { header: 'PG Fee', key: 'pgFee', width: 12 },
    { header: 'Net Amount', key: 'net', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Date', key: 'date', width: 20 },
  ]

  for (const w of withdrawals) {
    wd.addRow({
      month: w.monthKey,
      name: w.clientName,
      ref: w.refId,
      bank: w.bankName,
      account: w.accountNumber,
      amount: w.amount,
      fee: w.withdrawFee,
      pgFee: w.pgFee,
      net: w.netAmount,
      status: w.status,
      date: moment(w.createdAt).tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
    })
  }

  await wb.xlsx.writeFile(path.join(OUTPUT_ROOT, 'client-export.xlsx'))
}

async function exportSplitCsv(orders: OrderRow[], withdrawals: WithdrawRow[]) {
  const groupedOrders = new Map<string, OrderRow[]>()
  const groupedWithdrawals = new Map<string, WithdrawRow[]>()

  for (const o of orders) {
    const key = `${o.monthKey}__${o.partnerClientId}`
    if (!groupedOrders.has(key)) groupedOrders.set(key, [])
    groupedOrders.get(key)!.push(o)
  }

  for (const w of withdrawals) {
    const key = `${w.monthKey}__${w.partnerClientId}`
    if (!groupedWithdrawals.has(key)) groupedWithdrawals.set(key, [])
    groupedWithdrawals.get(key)!.push(w)
  }

  const keys = new Set([...groupedOrders.keys(), ...groupedWithdrawals.keys()])

  for (const key of keys) {
    const [monthKey, clientId] = key.split('__')
    const sample = groupedOrders.get(key)?.[0] ?? groupedWithdrawals.get(key)?.[0]
    const clientName = sample?.clientName ?? clientId
    const safeClient = sanitizeName(clientName)

    const orderRows = groupedOrders.get(key) ?? []
    await writeCsv(
      path.join(OUTPUT_ROOT, 'split-admin', monthKey, `${safeClient}-${clientId}-deposits.csv`),
      ['Month', 'Client Name', 'Client ID', 'Date', 'TRX ID', 'RRN', 'Player ID', 'Channel', 'Amount', 'Fee Launcx', 'Fee PG', 'Net Amount', 'Status'],
      orderRows.map(o => [
        o.monthKey,
        o.clientName,
        o.partnerClientId,
        moment(o.createdAt).tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        o.id,
        o.rrn,
        o.playerId,
        o.channel,
        o.amount,
        o.feeLauncx,
        o.fee3rdParty,
        o.netAmount,
        o.status,
      ])
    )

    const withdrawRows = groupedWithdrawals.get(key) ?? []
    await writeCsv(
      path.join(OUTPUT_ROOT, 'split-admin', monthKey, `${safeClient}-${clientId}-withdrawals.csv`),
      ['Month', 'Client Name', 'Client ID', 'Date', 'Ref ID', 'Bank', 'Account', 'Amount', 'Withdrawal Fee', 'PG Fee', 'Net Amount', 'Status'],
      withdrawRows.map(w => [
        w.monthKey,
        w.clientName,
        w.partnerClientId,
        moment(w.createdAt).tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
        w.refId,
        w.bankName,
        w.accountNumber,
        w.amount,
        w.withdrawFee,
        w.pgFee,
        w.netAmount,
        w.status,
      ])
    )

    await writeCsv(
      path.join(OUTPUT_ROOT, 'split-client', monthKey, `${safeClient}-${clientId}-transactions.csv`),
      ['Month', 'Child Name', 'Order ID', 'RRN', 'Player ID', 'Amount', 'Pending/Net', 'Fee', 'Status', 'Date'],
      orderRows.map(o => [
        o.monthKey,
        o.clientName,
        o.id,
        o.rrn,
        o.playerId,
        o.amount,
        o.netAmount,
        o.feeLauncx,
        o.status,
        moment(o.createdAt).tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
      ])
    )

    await writeCsv(
      path.join(OUTPUT_ROOT, 'split-client', monthKey, `${safeClient}-${clientId}-withdrawals.csv`),
      ['Month', 'Child Name', 'Ref ID', 'Bank', 'Account', 'Amount', 'Fee', 'PG Fee', 'Net Amount', 'Status', 'Date'],
      withdrawRows.map(w => [
        w.monthKey,
        w.clientName,
        w.refId,
        w.bankName,
        w.accountNumber,
        w.amount,
        w.withdrawFee,
        w.pgFee,
        w.netAmount,
        w.status,
        moment(w.createdAt).tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
      ])
    )
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
