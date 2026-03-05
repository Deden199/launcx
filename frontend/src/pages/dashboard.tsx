'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import dynamic from 'next/dynamic'
import { Tx, Withdrawal, SubBalance } from '@/types/dashboard'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { formatDateTimeInWIBShort } from '@/utils/datetime'

dayjs.extend(utc)
dayjs.extend(timezone)

function parseJwt(t: string) {
  try {
    return JSON.parse(atob(t.split('.')[1]))
  } catch {
    return null
  }
}

function mapWithdrawStatus(
  status: string
): 'PENDING' | 'COMPLETED' | 'FAILED' | undefined {
  const s = status.toUpperCase()
  return ['PENDING', 'COMPLETED', 'FAILED'].includes(s as any)
    ? (s as 'PENDING' | 'COMPLETED' | 'FAILED')
    : undefined
}

type RawTx = {
  id: string
  date: string
  playerId: string
  rrn?: string
  amount?: number
  feeLauncx?: number
  feePg?: number
  settlementStatus: string
  netSettle: number
  status?: string
  channel?: string
  paymentReceivedTime?: string
  settlementTime?: string
  trxExpirationTime?: string
}

interface AdminWithdrawal {
  id: string
  bankName: string
  bankCode: string
  accountNumber: string
  accountName: string
  amount: number
  pgRefId?: string | null
  status: string
  createdAt: string
  wallet: string
}

type Merchant = { id: string; name: string }

type TransactionsResponse = {
  transactions: RawTx[]
  total: number
  totalPending: number
  ordersActiveBalance: number
  totalMerchantBalance: number
  totalPaid: number
}

type MonthOption = {
  value: string
  label: string
}

const MONTH_OPTIONS: MonthOption[] = [
  { value: '2025-08', label: 'Agustus 2025' },
  { value: '2025-09', label: 'September 2025' },
  { value: '2025-10', label: 'Oktober 2025' },
  { value: '2025-11', label: 'November 2025' },
  { value: '2025-12', label: 'Desember 2025' },
  { value: '2026-01', label: 'Januari 2026' },
  { value: '2026-02', label: 'Februari 2026' },
]

const TransactionsTable = dynamic(() => import('@/components/dashboard/TransactionsTable'))
const WithdrawalHistory = dynamic(() => import('@/components/dashboard/WithdrawalHistory'))
const AdminWithdrawForm = dynamic(() => import('@/components/dashboard/AdminWithdrawForm'))

function getMonthBounds(monthValue: string) {
  const start = dayjs.tz(`${monthValue}-01 00:00:00`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Jakarta')
  const end = start.endOf('month')
  return {
    dateFrom: start.toISOString(),
    dateTo: end.toISOString(),
  }
}

export default function DashboardPage() {
  useRequireAuth()
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loadingWd, setLoadingWd] = useState(true)

  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [loadingMerchants, setLoadingMerchants] = useState(true)
  const [selectedMerchant, setSelectedMerchant] = useState<'all' | string>('all')

  const [subBalances, setSubBalances] = useState<SubBalance[]>([])
  const [selectedSub, setSelectedSub] = useState<string>('')

  const [adminWithdrawals, setAdminWithdrawals] = useState<AdminWithdrawal[]>([])
  const [loadingAdminWd, setLoadingAdminWd] = useState(true)

  const [wdAmount, setWdAmount] = useState('')
  const [wdAccount, setWdAccount] = useState('')
  const [wdBank, setWdBank] = useState('')
  const [wdName, setWdName] = useState('')
  const [otp, setOtp] = useState('')

  const [banks, setBanks] = useState<{ code: string; name: string }[]>([])
  const bankOptions = banks.map(b => ({ value: b.code, label: b.name }))

  const [isValid, setIsValid] = useState(false)
  const [busy, setBusy] = useState({ validating: false, submitting: false })
  const [error, setError] = useState('')

  const defaultMonth = MONTH_OPTIONS.some(option => option.value === dayjs().format('YYYY-MM'))
    ? dayjs().format('YYYY-MM')
    : MONTH_OPTIONS[0].value
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [withdrawStatusFilter, setWithdrawStatusFilter] = useState('')

  const [totalPages, setTotalPages] = useState(1)

  const [loadingTx, setLoadingTx] = useState(true)
  const [txs, setTxs] = useState<Tx[]>([])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const selectedMerchantName = selectedMerchant === 'all'
    ? 'Semua Client'
    : merchants.find(m => m.id === selectedMerchant)?.name || 'Semua Client'

  useEffect(() => {
    const tok = localStorage.getItem('token')
    if (tok) {
      const payload = parseJwt(tok)
      if (payload?.role === 'SUPER_ADMIN') setIsSuperAdmin(true)
    }
  }, [])

  useEffect(() => {
    api
      .get<{ banks: { code: string; name: string }[] }>('/banks')
      .then(res => setBanks(res.data.banks))
      .catch(console.error)
  }, [])

  function buildBaseParams() {
    const p: any = {}
    const { dateFrom, dateTo } = getMonthBounds(selectedMonth)
    p.date_from = dateFrom
    p.date_to = dateTo

    if (selectedMerchant !== 'all') p.partnerClientId = selectedMerchant
    return p
  }

  function buildTransactionParams() {
    const p = buildBaseParams()
    if (statusFilter !== 'all') p.status = statusFilter
    if (search.trim()) p.search = search.trim()
    p.page = page
    p.limit = perPage
    return p
  }

  const fetchBalances = async () => {
    try {
      const id = selectedMerchant === 'all' ? 'all' : selectedMerchant
      const { data } = await api.get<{ subBalances: SubBalance[] }>(`/admin/merchants/${id}/balances`)
      setSubBalances(data.subBalances)
      const current = data.subBalances.find(s => s.id === selectedSub) || data.subBalances[0]
      if (current) {
        setSelectedSub(current.id)
      }
    } catch (e) {
      console.error('fetchBalances error', e)
    }
  }

  async function fetchWithdrawals() {
    setLoadingWd(true)
    try {
      const params = buildBaseParams()
      const status = mapWithdrawStatus(withdrawStatusFilter)
      if (status) params.status = status
      const { data } = await api.get<{ data: Withdrawal[] }>(
        '/admin/merchants/dashboard/withdrawals',
        { params }
      )
      setWithdrawals(data.data)
    } catch (err: any) {
      console.error('fetchWithdrawals error', err)
    } finally {
      setLoadingWd(false)
    }
  }

  async function fetchAdminWithdrawals() {
    setLoadingAdminWd(true)
    try {
      const params = buildBaseParams()
      const status = mapWithdrawStatus(withdrawStatusFilter)
      if (status) params.status = status
      const { data } = await api.get<{ data: AdminWithdrawal[] }>(
        '/admin/merchants/dashboard/admin-withdrawals',
        { params }
      )
      setAdminWithdrawals(data.data)
    } catch (err: any) {
      console.error('fetchAdminWithdrawals error', err)
    } finally {
      setLoadingAdminWd(false)
    }
  }

  async function handleAdminWithdraw(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || error) return
    setBusy(b => ({ ...b, submitting: true }))
    try {
      await api.post('/admin/merchants/dashboard/withdraw', {
        subMerchantId: selectedSub,
        amount: Number(wdAmount),
        bank_code: wdBank,
        account_number: wdAccount,
        account_name: wdName,
        otp,
      })
      setWdAmount('')
      setWdAccount('')
      setWdBank('')
      setWdName('')
      setOtp('')
      setIsValid(false)
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed')
    } finally {
      setBusy(b => ({ ...b, submitting: false }))
    }
  }

  async function validateBankAccount() {
    setBusy(b => ({ ...b, validating: true }))
    setError('')
    try {
      const res = await api.post(
        '/admin/merchants/dashboard/validate-account',
        {
          subMerchantId: selectedSub,
          bank_code: wdBank,
          account_number: wdAccount,
        },
        { validateStatus: () => true }
      )
      if (res.status === 200 && res.data.status === 'valid') {
        setWdName(res.data.account_holder)
        setIsValid(true)
      } else {
        setIsValid(false)
        setError(res.data.error || 'Account not valid')
      }
    } catch {
      setIsValid(false)
      setError('Validation failed')
    } finally {
      setBusy(b => ({ ...b, validating: false }))
    }
  }

  const fetchTransactions = async () => {
    setLoadingTx(true)
    try {
      const params = buildTransactionParams()
      const { data } = await api.get<TransactionsResponse>(
        '/admin/merchants/dashboard/transactions',
        { params }
      )

      setTotalPages(Math.max(1, Math.ceil(data.total / perPage)))

      const VALID_STATUSES: Tx['status'][] = ['SUCCESS', 'PENDING', 'EXPIRED', 'DONE', 'PAID', 'LN_SETTLED']

      const mapped: Tx[] = data.transactions.map(o => {
        const raw = o.status ?? ''
        const statusTyped: Tx['status'] = VALID_STATUSES.includes(raw as Tx['status'])
          ? (raw as Tx['status'])
          : ''
        return {
          id: o.id,
          date: o.paymentReceivedTime || o.date,
          rrn: o.rrn ?? '-',
          playerId: o.playerId,
          amount: o.amount ?? 0,
          feeLauncx: o.feeLauncx ?? 0,
          feePg: o.feePg ?? 0,
          netSettle: o.netSettle,
          status: statusTyped,
          settlementStatus: o.settlementStatus.replace(/_/g, ' '),
          paymentReceivedTime: o.paymentReceivedTime ?? '',
          settlementTime: o.settlementTime ?? '',
          trxExpirationTime: o.trxExpirationTime ?? '',
          channel: o.channel ?? '-',
        }
      })

      const q = search.trim().toLowerCase()
      const filtered = q
        ? mapped.filter(t =>
            t.id.toLowerCase().includes(q) ||
            t.rrn.toLowerCase().includes(q) ||
            t.playerId.toLowerCase().includes(q)
          )
        : mapped

      setTxs(filtered)
    } catch (e) {
      console.error('fetchTransactions error', e)
    } finally {
      setLoadingTx(false)
    }
  }

  useEffect(() => {
    setLoadingMerchants(true)
    api
      .get<Merchant[]>('/admin/merchants/allclient')
      .then(res => setMerchants(res.data))
      .catch(err => console.error('fetch merchants error', err))
      .finally(() => setLoadingMerchants(false))
  }, [])

  useEffect(() => {
    fetchAdminWithdrawals()
    fetchWithdrawals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, selectedMerchant, withdrawStatusFilter])

  useEffect(() => {
    fetchBalances()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMerchant])

  useEffect(() => {
    fetchTransactions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, selectedMerchant, search, statusFilter, page, perPage])

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-6 bg-neutral-950 text-neutral-100">
      <div className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/70 backdrop-blur p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-4 lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Launcx Dashboard</h1>
            <p className="text-sm text-neutral-400">Monitor transaksi bulanan.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full lg:w-auto">
            <label className="sm:col-span-1">
              <span className="block text-xs font-medium text-neutral-400 mb-1">Client</span>
              <select
                value={selectedMerchant}
                onChange={e => {
                  setSelectedMerchant(e.target.value)
                  setPage(1)
                  setSearch('')
                  setStatusFilter('all')
                  setWithdrawStatusFilter('')
                }}
                disabled={loadingMerchants}
                className="w-full h-10 rounded-xl border border-neutral-800 px-3 text-sm bg-neutral-950 focus:outline-none focus:ring-2 focus:ring-indigo-800 disabled:opacity-60"
              >
                <option value="all">{loadingMerchants ? 'Memuat client...' : 'Semua Client'}</option>
                {merchants.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>

            <label className="sm:col-span-1">
              <span className="block text-xs font-medium text-neutral-400 mb-1">Bulan</span>
              <select
                value={selectedMonth}
                onChange={e => { setSelectedMonth(e.target.value); setPage(1) }}
                className="w-full h-10 rounded-xl border border-neutral-800 px-3 text-sm bg-neutral-950 focus:outline-none focus:ring-2 focus:ring-indigo-800"
              >
                {MONTH_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {isSuperAdmin && (
        <div className="rounded-2xl border border-neutral-800 p-4 sm:p-5 bg-neutral-900/70 shadow-sm">
          <AdminWithdrawForm
            subBalances={subBalances}
            selectedSub={selectedSub}
            setSelectedSub={setSelectedSub}
            wdAmount={wdAmount}
            setWdAmount={setWdAmount}
            wdAccount={wdAccount}
            setWdAccount={setWdAccount}
            wdBank={wdBank}
            setWdBank={setWdBank}
            wdName={wdName}
            otp={otp}
            setOtp={setOtp}
            bankOptions={bankOptions}
            isValid={isValid}
            busy={busy}
            error={error}
            validateBankAccount={validateBankAccount}
            handleAdminWithdraw={handleAdminWithdraw}
          />
        </div>
      )}

      <div className="space-y-6">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 shadow-sm">
          <TransactionsTable
            search={search}
            setSearch={setSearch}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            loadingTx={loadingTx}
            txs={txs}
            perPage={perPage}
            setPerPage={setPerPage}
            page={page}
            setPage={setPage}
            totalPages={totalPages}
            buildParams={buildTransactionParams}
            selectedMerchantName={selectedMerchantName}
            onDateChange={(_dates) => undefined}
            disableDateFilter
          />
        </div>
        <section className="rounded-2xl border border-neutral-800 p-4 sm:p-5 bg-neutral-900/70 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">Withdrawal History</h2>
          <WithdrawalHistory loadingWd={loadingWd} withdrawals={withdrawals} />
        </section>
      </div>

      {isSuperAdmin && (
        <section className="rounded-2xl border border-neutral-800 p-4 sm:p-5 bg-neutral-900/70 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">Admin Withdrawals</h2>
          {loadingAdminWd ? (
            <div className="text-sm text-neutral-400">Loading withdrawals…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 bg-neutral-900/60">
                    <th className="text-left font-medium px-3 py-2">Date</th>
                    <th className="text-left font-medium px-3 py-2">Wallet</th>
                    <th className="text-left font-medium px-3 py-2">Bank</th>
                    <th className="text-left font-medium px-3 py-2">Account No.</th>
                    <th className="text-left font-medium px-3 py-2">Account Name</th>
                    <th className="text-left font-medium px-3 py-2">Amount</th>
                    <th className="text-left font-medium px-3 py-2">PG Ref ID</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {adminWithdrawals.length ? (
                    adminWithdrawals.map(a => (
                      <tr key={a.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900/60">
                        <td className="px-3 py-2 whitespace-nowrap">{formatDateTimeInWIBShort(a.createdAt)}</td>
                        <td className="px-3 py-2">{a.wallet}</td>
                        <td className="px-3 py-2">{a.bankName}</td>
                        <td className="px-3 py-2">{a.accountNumber}</td>
                        <td className="px-3 py-2">{a.accountName}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium">
                          {a.amount.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                        </td>
                        <td className="px-3 py-2">{a.pgRefId ?? '-'}</td>
                        <td className="px-3 py-2">{a.status}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-neutral-400">No withdrawals</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
