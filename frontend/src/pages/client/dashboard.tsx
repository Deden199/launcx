'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/apiClient'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { ClipboardCopy, Wallet, Clock, ListChecks, FileText, CreditCard } from 'lucide-react'

type RawStatus = '' | 'SUCCESS' | 'DONE' | 'SETTLED' | 'PAID' | 'PENDING' | 'EXPIRED'
type Tx = {
  id: string
  date: string
  reference: string
  rrn: string
  playerId: string
  amount: number
  feeLauncx: number
  netSettle: number
  status: RawStatus
  settlementStatus?: string
  paymentReceivedTime?: string
  settlementTime?: string
  trxExpirationTime?: string
}

type ClientOption = { id: string; name: string }

export default function ClientDashboardPage() {
  const router = useRouter()

  // Parent–Child
  const [children, setChildren] = useState<ClientOption[]>([])
  const [selectedChild, setSelectedChild] = useState<'' | 'all' | string>('')

  // Date range (custom)
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [startDate, endDate] = dateRange

  // Summary
  const [balance, setBalance] = useState(0)
  const [totalPend, setTotalPend] = useState(0)
  const [totalTrans, setTotalTrans] = useState(0)
  const [totalSettlement, setTotalSettlement] = useState(0)
  const [totalPaid, setTotalPaid] = useState(0)
  const [exporting, setExporting] = useState(false)

  // Transactions
  const [txs, setTxs] = useState<Tx[]>([])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingTx, setLoadingTx] = useState(false)

  // Date filter
  const [range, setRange] = useState<
    '1-3h' | '3-6h' | '6-12h' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'
  >('1-3h')
  const [statusFilter, setStatusFilter] = useState<string>('PAID')

  // Search
  const [search, setSearch] = useState('')

  const normalizeStatus = (s: string): string => (s === 'DONE' || s === 'SETTLED' ? 'SUCCESS' : s)

  const handleApply = () => {
    if (!selectedChild) return
    fetchSummary()
    fetchTransactions()
  }

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const buildParams = () => {
    const params: Record<string, any> = {}
    const now = new Date()

    if (range === 'custom' && startDate && endDate) {
      params.date_from = startDate.toISOString()
      params.date_to = endDate.toISOString()
    } else {
      let from: Date
      switch (range) {
        case '1-3h':
          from = new Date(now.getTime() - 3 * 60 * 60 * 1000)
          break
        case '3-6h':
          from = new Date(now.getTime() - 6 * 60 * 60 * 1000)
          break
        case '6-12h':
          from = new Date(now.getTime() - 12 * 60 * 60 * 1000)
          break
        case 'today':
          from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          break
        case 'yesterday':
          from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
          params.date_to = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
          break
        case 'week':
          from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          break
        case 'month':
          from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          break
        default:
          from = new Date(now.getTime() - 3 * 60 * 60 * 1000)
      }
      params.date_from = from.toISOString()
      if (!params.date_to) params.date_to = now.toISOString()
    }

    if (statusFilter) {
      params.status = statusFilter === 'SUCCESS' ? ['SUCCESS', 'DONE', 'SETTLED'] : statusFilter
    }
    if (selectedChild && selectedChild !== 'all') params.clientId = selectedChild
    if (search.trim()) params.search = search.trim()
    // Filter VA transactions only (for VA launch)
    params.channel = 'VA'
    params.page = page
    params.limit = perPage
    return params
  }

  // Initialize
  useEffect(() => {
    const init = async () => {
      try {
        const { data } = await api.get<{
          children: ClientOption[]
        }>('/client/dashboard', { params: { page: 1, limit: 1 } })
        const list = data.children || []
        setChildren(list)
        if (list.length > 0) {
          setSelectedChild('all')
        } else {
          setSelectedChild('all')
        }
      } catch (err: any) {
        if (err?.response?.status === 401) {
          router.push('/client/login')
        }
      }
    }
    init()
  }, [router])

  // Fetch summary
  const fetchSummary = async () => {
    if (!selectedChild) return
    setLoadingSummary(true)
    try {
      const { data } = await api.get<{
        balance: number
        totalPending: number
        totalCount: number
        totalSettlement?: number
        totalPaid?: number
        children: ClientOption[]
      }>('/client/dashboard', { params: buildParams() })

      setBalance(data.balance)
      setTotalPend(data.totalPending)
      setTotalSettlement(data.totalSettlement || 0)
      setTotalPaid(data.totalPaid || 0)
      setChildren(data.children)
      setTotalTrans(data.totalCount)
    } catch (err: any) {
      if (err?.response?.status === 401) {
        router.push('/client/login')
      } else {
        console.error('Failed to fetch summary', err)
      }
    } finally {
      setLoadingSummary(false)
    }
  }

  // Fetch transactions
  const fetchTransactions = async () => {
    if (!selectedChild) return
    setLoadingTx(true)
    try {
      const { data } = await api.get<{
        transactions: Tx[]
        total: number
      }>('/client/dashboard', { params: buildParams() })

      setTxs(data.transactions || [])
      setTotalPages(Math.max(1, Math.ceil(data.total / perPage)))
    } catch (err: any) {
      console.error('Failed to fetch transactions', err)
    } finally {
      setLoadingTx(false)
    }
  }

  // Export
  const handleExport = async () => {
    if (!selectedChild) return
    setExporting(true)
    try {
      const params = buildParams()
      const response = await api.get('/client/dashboard/export', {
        params,
        responseType: 'blob'
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `qris-transactions-${new Date().toISOString().split('T')[0]}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      console.error('Export failed', err)
    } finally {
      setExporting(false)
    }
  }

  // Trigger fetches when filters change
  useEffect(() => {
    if (!selectedChild) return
    if (range !== 'custom' || (startDate && endDate)) fetchSummary()
  }, [range, selectedChild, startDate, endDate, statusFilter])

  useEffect(() => {
    if (!selectedChild) return
    if (range !== 'custom' || (startDate && endDate)) fetchTransactions()
  }, [range, selectedChild, startDate, endDate, search, page, perPage, statusFilter])

  const filtered = (txs || []).filter(t =>
    (statusFilter === '' || normalizeStatus(t.status) === statusFilter) &&
    (
      t.id.toLowerCase().includes(search.toLowerCase()) ||
      t.rrn.toLowerCase().includes(search.toLowerCase()) ||
      t.playerId.toLowerCase().includes(search.toLowerCase())
    )
  )

  if (loadingSummary) {
    return (
      <div className="dark min-h-screen grid place-items-center bg-neutral-950 text-neutral-100">
        <div className="text-sm text-neutral-400">Loading summary…</div>
      </div>
    )
  }

  return (
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ListChecks className="text-emerald-400" />
              Dashboard QRIS
            </h1>
            <p className="text-sm text-neutral-400 mt-1">Monitor transaksi pembayaran QRIS</p>
          </div>
          <button
            onClick={() => router.push('/client/va-dashboard')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-indigo-600 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-200 transition-colors"
            data-testid="go-to-va-dashboard"
          >
            <CreditCard size={16} />
            Dashboard Virtual Account
          </button>
        </div>

        {/* Child Selector */}
        {(children || []).length > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-neutral-300">Pilih Child:</span>
            <select
              value={selectedChild}
              onChange={e => { setSelectedChild(e.target.value as any); setPage(1) }}
              className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
            >
              <option value="">Pilih Child</option>
              <option value="all">All</option>
              {(children || []).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Stats */}
        {selectedChild && (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-neutral-400">Transactions</div>
                  <div className="mt-1 text-xl font-semibold">{(totalTrans ?? 0).toLocaleString()}</div>
                </div>
                <ListChecks className="opacity-80" />
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-neutral-400">Pending Settlement</div>
                  <div className="mt-1 text-xl font-semibold">
                    {(totalPend ?? 0).toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                  </div>
                </div>
                <Clock className="opacity-80" />
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-neutral-400">Total Settlement</div>
                  <div className="mt-1 text-xl font-semibold">
                    {(totalSettlement ?? 0).toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                  </div>
                </div>
                <Wallet className="opacity-80" />
              </div>
            </div>
          </section>
        )}

        {/* Filters */}
        {selectedChild && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 mb-4 shadow-sm">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Date Range */}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Rentang</span>
                <select
                  value={range}
                  onChange={e => { setRange(e.target.value as any); setPage(1) }}
                  className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
                >
                  <option value="1-3h">1-3 Jam (no export)</option>
                  <option value="3-6h">3-6 Jam (no export)</option>
                  <option value="6-12h">6-12 Jam (no export)</option>
                  <option value="today">Hari Ini (export)</option>
                  <option value="yesterday">Kemarin (export)</option>
                  <option value="week">7 Hari (export)</option>
                  <option value="month">30 Hari (export)</option>
                  <option value="custom">Custom</option>
                </select>
              </label>

              {/* Custom Date */}
              {range === 'custom' && (
                <div className="col-span-2 flex items-end gap-2">
                  <DatePicker
                    selectsRange
                    startDate={startDate}
                    endDate={endDate}
                    onChange={(update) => setDateRange(update)}
                    className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
                    dateFormat="dd/MM/yyyy"
                    placeholderText="Pilih rentang tanggal"
                  />
                  <button
                    onClick={handleApply}
                    className="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-medium hover:bg-indigo-700"
                  >
                    Terapkan
                  </button>
                </div>
              )}

              {/* Status */}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Status</span>
                <select
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
                  className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
                >
                  <option value="">All Status</option>
                  <option value="SUCCESS">SUCCESS / DONE / SETTLED</option>
                  <option value="PAID">PAID</option>
                  <option value="PENDING">PENDING</option>
                  <option value="EXPIRED">EXPIRED</option>
                </select>
              </label>

              {/* Search */}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Search</span>
                <input
                  type="text"
                  placeholder="Search TRX ID, RRN, atau Player ID…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm placeholder:text-neutral-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                />
              </label>

              {/* Export */}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">&nbsp;</span>
                <button
                  onClick={handleExport}
                  disabled={exporting || !['today', 'yesterday', 'week', 'month'].includes(range)}
                  className="h-10 w-full rounded-xl border border-indigo-600 bg-indigo-600 hover:bg-indigo-700 px-3 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <FileText size={14} />
                  {exporting ? 'Exporting...' : 'Export'}
                </button>
              </label>
            </div>
          </section>
        )}

        {/* Transactions Table */}
        {selectedChild && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Transaction List &amp; Settlement</h2>
              {!loadingTx && (
                <div className="text-xs text-neutral-400">
                  {(filtered || []).length ? `${(filtered || []).length.toLocaleString('id-ID')} baris` : '—'}
                </div>
              )}
            </div>

            {loadingTx ? (
              <div className="grid gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-neutral-800" />
                ))}
              </div>
            ) : (
              <div className="-mx-2 overflow-x-auto px-2">
                <table className="min-w-[1100px] w-full text-sm" data-testid="transactions-table">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
                      {[
                        'Date', 'Update At', 'TRX ID', 'RRN', 'Player ID',
                        'Amount', 'Fee', 'Net Amount', 'Status', 'Settlement Status', 'Action',
                      ].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-neutral-300">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(filtered || []).map((t) => (
                      <tr key={t.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900/60">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(t.date).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {t.paymentReceivedTime
                            ? new Date(t.paymentReceivedTime).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
                            : '-'}
                        </td>

                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[12px]">{t.id}</code>
                            <button
                              title="Copy TRX ID"
                              onClick={() => copyText(t.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-800 hover:bg-neutral-800/60"
                            >
                              <ClipboardCopy size={14} />
                            </button>
                          </div>
                        </td>

                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="max-w-[220px] truncate">{t.rrn}</span>
                            <button
                              title="Copy RRN"
                              onClick={() => copyText(t.rrn)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-800 hover:bg-neutral-800/60"
                            >
                              <ClipboardCopy size={14} />
                            </button>
                          </div>
                        </td>

                        <td className="px-3 py-2">{t.playerId}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-right">
                          {t.amount.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right">
                          {t.feeLauncx.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right font-semibold">
                          {t.netSettle.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                        </td>

                        <td className="px-3 py-2">
                          {['SUCCESS', 'DONE', 'SETTLED'].includes(t.status)
                            ? 'SUCCESS'
                            : t.status === 'PAID'
                            ? 'PAID'
                            : t.status === 'PENDING'
                            ? 'PENDING'
                            : t.status === 'EXPIRED'
                            ? 'EXPIRED'
                            : '-'}
                        </td>

                        <td className="px-3 py-2">
                          {t.settlementStatus === 'COMPLETED'
                            ? <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] text-emerald-400">COMPLETED</span>
                            : t.settlementStatus === 'PENDING'
                            ? <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-400">PENDING</span>
                            : '-'}
                        </td>

                        <td className="px-3 py-2">
                          <button
                            onClick={() => copyText(t.id)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-neutral-800 px-2 text-xs hover:bg-neutral-800/60"
                          >
                            <ClipboardCopy size={12} /> Copy
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
              <div className="flex items-center gap-2 text-sm">
                <span>Rows</span>
                <select
                  value={perPage}
                  onChange={e => { setPerPage(+e.target.value); setPage(1) }}
                  className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 px-2 text-sm"
                >
                  {[10, 20, 50].map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-neutral-800 px-2.5 disabled:opacity-50 hover:bg-neutral-800/60"
                >
                  ‹
                </button>
                <span className="min-w-[70px] text-center">
                  {page}/{totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-neutral-800 px-2.5 disabled:opacity-50 hover:bg-neutral-800/60"
                >
                  ›
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
