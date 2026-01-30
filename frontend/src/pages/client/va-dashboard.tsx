'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/apiClient'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { 
  ClipboardCopy, Clock, ListChecks, CreditCard, Building2, 
  RefreshCw, ChevronLeft, ChevronRight, Download, AlertCircle,
  CheckCircle2, XCircle, Timer
} from 'lucide-react'

type RawStatus = '' | 'SUCCESS' | 'DONE' | 'SETTLED' | 'PAID' | 'PENDING' | 'EXPIRED' | 'LN_SETTLED'

type VaTx = {
  id: string
  date: string
  vaNumber: string
  bankCode: string
  bankName: string
  playerId: string
  amount: number
  feeLauncx: number
  netSettle: number
  status: RawStatus
  settlementStatus?: string
  paymentReceivedTime?: string
  trxExpirationTime?: string
  usernameDisplay?: string
}

type VaStats = {
  total: number
  pending: number
  success: number
  expired: number
  totalAmount: number
  totalPaid: number
}

type VaBank = { code: string; name: string }

type ActiveVa = {
  id: string
  vaNumber: string
  bankCode: string
  bankName: string
  amount: number
  isOpen: boolean
  playerId: string
  usernameDisplay: string
  status: string
  vaStatus: string
  createdAt: string
  expiresAt: string
}

type ClientOption = { id: string; name: string }

// VA Bank mapping
const VA_BANKS: VaBank[] = [
  { code: '002', name: 'BRI' },
  { code: '008', name: 'Mandiri' },
  { code: '009', name: 'BNI' },
  { code: '013', name: 'Permata' },
  { code: '022', name: 'CIMB' },
]

export default function VaDashboardPage() {
  const router = useRouter()

  // Parent–Child
  const [children, setChildren] = useState<ClientOption[]>([])
  const [selectedChild, setSelectedChild] = useState<'' | 'all' | string>('')

  // Date range
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [startDate, endDate] = dateRange

  // Stats
  const [vaStats, setVaStats] = useState<VaStats>({
    total: 0, pending: 0, success: 0, expired: 0, totalAmount: 0, totalPaid: 0
  })

  // Transactions
  const [txs, setTxs] = useState<VaTx[]>([])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [loadingTx, setLoadingTx] = useState(false)
  const [loadingStats, setLoadingStats] = useState(false)

  // Active VAs
  const [activeVas, setActiveVas] = useState<ActiveVa[]>([])
  const [loadingVa, setLoadingVa] = useState(false)
  const [activeTab, setActiveTab] = useState<'transactions' | 'active'>('transactions')

  // Filters
  const [bankFilter, setBankFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [range, setRange] = useState<'1-3h' | '3-6h' | '6-12h' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'>('today')
  const [search, setSearch] = useState('')

  // Export
  const [exporting, setExporting] = useState(false)

  const normalizeStatus = (s: string): string => 
    ['DONE', 'SETTLED', 'LN_SETTLED'].includes(s) ? 'SUCCESS' : s

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  // Build params for API
  const buildParams = () => {
    const params: Record<string, any> = {}
    const now = new Date()

    // Date range
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
      params.status = statusFilter === 'SUCCESS' ? ['SUCCESS', 'DONE', 'SETTLED', 'LN_SETTLED'] : statusFilter
    }
    if (selectedChild && selectedChild !== 'all') params.clientId = selectedChild
    if (search.trim()) params.search = search.trim()
    if (bankFilter) params.bankCode = bankFilter
    params.page = page
    params.limit = perPage

    return params
  }

  // Fetch VA Dashboard data
  const fetchVaDashboard = async () => {
    if (!selectedChild) return
    setLoadingStats(true)
    setLoadingTx(true)

    try {
      const params = buildParams()
      const { data } = await api.get<{
        transactions: VaTx[]
        total: number
        stats: VaStats
        children: ClientOption[]
      }>('/client/va-dashboard', { params })

      setTxs(data.transactions || [])
      setTotalCount(data.total || 0)
      setTotalPages(Math.max(1, Math.ceil((data.total || 0) / perPage)))
      setVaStats(data.stats || { total: 0, pending: 0, success: 0, expired: 0, totalAmount: 0, totalPaid: 0 })
      if (data.children) setChildren(data.children)
    } catch (err: any) {
      if (err?.response?.status === 401) {
        router.push('/client/login')
      } else {
        console.error('Failed to fetch VA dashboard', err)
      }
    } finally {
      setLoadingStats(false)
      setLoadingTx(false)
    }
  }

  // Fetch Active VAs
  const fetchActiveVas = async () => {
    if (!selectedChild) return
    setLoadingVa(true)

    try {
      const params: Record<string, any> = { limit: 50 }
      if (selectedChild && selectedChild !== 'all') params.clientId = selectedChild
      if (bankFilter) params.bankCode = bankFilter

      const { data } = await api.get<{ data: ActiveVa[]; total: number }>('/client/va-active', { params })
      setActiveVas(data.data || [])
    } catch (err: any) {
      console.error('Failed to fetch active VAs', err)
    } finally {
      setLoadingVa(false)
    }
  }

  // Export
  const handleExport = async () => {
    if (!selectedChild) return
    setExporting(true)
    try {
      const params = buildParams()
      params.channel = 'VA_DANARAPAY'
      const response = await api.get('/client/dashboard/export', {
        params,
        responseType: 'blob'
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `va-transactions-${new Date().toISOString().split('T')[0]}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      console.error('Export failed', err)
    } finally {
      setExporting(false)
    }
  }

  // Initialize - check auth and load children
  useEffect(() => {
    const init = async () => {
      try {
        const { data } = await api.get<{ children: ClientOption[] }>('/client/va-dashboard', {
          params: { page: 1, limit: 1 }
        })
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

  // Fetch data when filters change
  useEffect(() => {
    if (!selectedChild) return
    if (range !== 'custom' || (startDate && endDate)) {
      fetchVaDashboard()
    }
  }, [range, selectedChild, startDate, endDate, statusFilter, bankFilter, page, perPage, search])

  // Fetch active VAs when tab changes
  useEffect(() => {
    if (activeTab === 'active' && selectedChild) {
      fetchActiveVas()
    }
  }, [activeTab, selectedChild, bankFilter])

  const getStatusBadge = (status: string) => {
    const normalized = normalizeStatus(status)
    switch (normalized) {
      case 'SUCCESS':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"><CheckCircle2 size={12} /> SUCCESS</span>
      case 'PAID':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30"><CheckCircle2 size={12} /> PAID</span>
      case 'PENDING':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30"><Timer size={12} /> PENDING</span>
      case 'EXPIRED':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30"><XCircle size={12} /> EXPIRED</span>
      default:
        return <span className="text-neutral-400">{status || '-'}</span>
    }
  }

  return (
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="text-indigo-400" />
              Virtual Account Dashboard
            </h1>
            <p className="text-sm text-neutral-400 mt-1">Monitor transaksi Virtual Account</p>
          </div>
          <button
            onClick={() => router.push('/client/dashboard')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-neutral-700 hover:bg-neutral-800 transition-colors"
          >
            <ChevronLeft size={16} />
            Kembali ke Dashboard QRIS
          </button>
        </div>

        {/* Child Selector */}
        {(children || []).length > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-neutral-300">Pilih Client:</span>
            <select
              value={selectedChild}
              onChange={e => { setSelectedChild(e.target.value); setPage(1) }}
              className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
              data-testid="client-selector"
            >
              <option value="">Pilih Client</option>
              <option value="all">All</option>
              {(children || []).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Stats Cards */}
        {selectedChild && (
          <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
              <div className="text-xs text-neutral-400 mb-1">Total VA</div>
              <div className="text-xl font-bold">{(vaStats.total ?? 0).toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4">
              <div className="text-xs text-amber-300 mb-1 flex items-center gap-1"><Timer size={12} /> Pending</div>
              <div className="text-xl font-bold text-amber-300">{(vaStats.pending ?? 0).toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-4">
              <div className="text-xs text-emerald-300 mb-1 flex items-center gap-1"><CheckCircle2 size={12} /> Success</div>
              <div className="text-xl font-bold text-emerald-300">{(vaStats.success ?? 0).toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-4">
              <div className="text-xs text-red-300 mb-1 flex items-center gap-1"><XCircle size={12} /> Expired</div>
              <div className="text-xl font-bold text-red-300">{(vaStats.expired ?? 0).toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-indigo-800/50 bg-indigo-950/20 p-4">
              <div className="text-xs text-indigo-300 mb-1">Total Amount</div>
              <div className="text-lg font-bold text-indigo-300">
                {(vaStats.totalAmount ?? 0).toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="rounded-xl border border-blue-800/50 bg-blue-950/20 p-4">
              <div className="text-xs text-blue-300 mb-1">Total Paid</div>
              <div className="text-lg font-bold text-blue-300">
                {(vaStats.totalPaid ?? 0).toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
              </div>
            </div>
          </section>
        )}

        {/* Tabs */}
        {selectedChild && (
          <div className="mb-4 flex gap-2 border-b border-neutral-800 pb-2">
            <button
              onClick={() => setActiveTab('transactions')}
              className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${
                activeTab === 'transactions' 
                  ? 'bg-indigo-600 text-white' 
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
              data-testid="tab-transactions"
            >
              <ListChecks size={16} className="inline mr-2" />
              Transaksi VA
            </button>
            <button
              onClick={() => setActiveTab('active')}
              className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${
                activeTab === 'active' 
                  ? 'bg-indigo-600 text-white' 
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
              data-testid="tab-active-va"
            >
              <Building2 size={16} className="inline mr-2" />
              VA Aktif
            </button>
          </div>
        )}

        {/* Filters */}
        {selectedChild && activeTab === 'transactions' && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 mb-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* Date Range */}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Rentang Waktu</span>
                <select
                  value={range}
                  onChange={e => { setRange(e.target.value as any); setPage(1) }}
                  className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
                  data-testid="range-filter"
                >
                  <option value="1-3h">1-3 Jam</option>
                  <option value="3-6h">3-6 Jam</option>
                  <option value="6-12h">6-12 Jam</option>
                  <option value="today">Hari Ini</option>
                  <option value="yesterday">Kemarin</option>
                  <option value="week">7 Hari</option>
                  <option value="month">30 Hari</option>
                  <option value="custom">Custom</option>
                </select>
              </label>

              {/* Custom Date */}
              {range === 'custom' && (
                <label className="block col-span-2">
                  <span className="mb-1 block text-xs text-neutral-400">Pilih Tanggal</span>
                  <DatePicker
                    selectsRange
                    startDate={startDate}
                    endDate={endDate}
                    onChange={(update) => setDateRange(update)}
                    className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
                    dateFormat="dd/MM/yyyy"
                    placeholderText="Pilih rentang tanggal"
                  />
                </label>
              )}

              {/* Status */}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Status</span>
                <select
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
                  className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
                  data-testid="status-filter"
                >
                  <option value="">Semua Status</option>
                  <option value="SUCCESS">SUCCESS</option>
                  <option value="PAID">PAID</option>
                  <option value="PENDING">PENDING</option>
                  <option value="EXPIRED">EXPIRED</option>
                </select>
              </label>

              {/* Bank */}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Bank VA</span>
                <select
                  value={bankFilter}
                  onChange={e => { setBankFilter(e.target.value); setPage(1) }}
                  className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
                  data-testid="bank-filter"
                >
                  <option value="">Semua Bank</option>
                  {VA_BANKS.map(b => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
              </label>

              {/* Search */}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Cari</span>
                <input
                  type="text"
                  placeholder="VA Number / TRX ID"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm placeholder:text-neutral-500"
                  data-testid="search-input"
                />
              </label>

              {/* Export */}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">&nbsp;</span>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="h-10 w-full rounded-xl border border-indigo-700 bg-indigo-600 hover:bg-indigo-700 px-3 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  data-testid="export-btn"
                >
                  <Download size={14} />
                  {exporting ? 'Exporting...' : 'Export'}
                </button>
              </label>
            </div>
          </section>
        )}

        {/* Bank Filter for Active VA tab */}
        {selectedChild && activeTab === 'active' && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 mb-4">
            <div className="flex items-center gap-4">
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Filter Bank</span>
                <select
                  value={bankFilter}
                  onChange={e => setBankFilter(e.target.value)}
                  className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
                >
                  <option value="">Semua Bank</option>
                  {VA_BANKS.map(b => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={fetchActiveVas}
                disabled={loadingVa}
                className="h-10 mt-5 px-4 rounded-xl border border-neutral-700 hover:bg-neutral-800 flex items-center gap-2 text-sm disabled:opacity-50"
              >
                <RefreshCw size={14} className={loadingVa ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </section>
        )}

        {/* Transactions Table */}
        {selectedChild && activeTab === 'transactions' && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Daftar Transaksi VA</h2>
              <div className="text-xs text-neutral-400">
                {loadingTx ? 'Loading...' : `${totalCount.toLocaleString()} transaksi`}
              </div>
            </div>

            {loadingTx ? (
              <div className="grid gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-neutral-800" />
                ))}
              </div>
            ) : (txs || []).length === 0 ? (
              <div className="text-center py-12 text-neutral-400">
                <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
                <p>Tidak ada transaksi VA ditemukan</p>
              </div>
            ) : (
              <div className="-mx-2 overflow-x-auto px-2">
                <table className="min-w-[1200px] w-full text-sm" data-testid="va-transactions-table">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
                      {['Tanggal', 'Bank', 'VA Number', 'TRX ID', 'Player ID', 'Amount', 'Fee', 'Net', 'Status'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-neutral-300">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(txs || []).map(t => (
                      <tr key={t.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900/60">
                        <td className="px-3 py-2 whitespace-nowrap text-xs">
                          {new Date(t.date).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex px-2 py-0.5 rounded bg-indigo-600/30 text-indigo-200 text-xs font-medium">
                            {t.bankName || t.bankCode || '-'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <code className="text-xs font-mono text-neutral-200">{t.vaNumber || '-'}</code>
                            {t.vaNumber && (
                              <button
                                onClick={() => copyText(t.vaNumber)}
                                className="p-1 rounded hover:bg-neutral-700"
                                title="Copy VA"
                              >
                                <ClipboardCopy size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <code className="text-xs rounded bg-neutral-800 px-1.5 py-0.5">{t.id}</code>
                            <button
                              onClick={() => copyText(t.id)}
                              className="p-1 rounded hover:bg-neutral-700"
                              title="Copy TRX ID"
                            >
                              <ClipboardCopy size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">{t.playerId || t.usernameDisplay || '-'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {(t.amount ?? 0).toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap text-neutral-400">
                          {(t.feeLauncx ?? 0).toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                          {(t.netSettle ?? 0).toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-3 py-2">{getStatusBadge(t.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {(txs || []).length > 0 && (
              <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
                <div className="flex items-center gap-2 text-sm">
                  <span>Rows:</span>
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
                    className="h-9 px-3 rounded-lg border border-neutral-800 disabled:opacity-50 hover:bg-neutral-800"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="min-w-[80px] text-center">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="h-9 px-3 rounded-lg border border-neutral-800 disabled:opacity-50 hover:bg-neutral-800"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Active VA Grid */}
        {selectedChild && activeTab === 'active' && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">VA Aktif (Menunggu Pembayaran)</h2>
              <span className="text-xs text-neutral-400">
                {loadingVa ? 'Loading...' : `${(activeVas || []).length} VA aktif`}
              </span>
            </div>

            {loadingVa ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-xl bg-neutral-800" />
                ))}
              </div>
            ) : (activeVas || []).length === 0 ? (
              <div className="text-center py-12 text-neutral-400">
                <Building2 size={32} className="mx-auto mb-2 opacity-50" />
                <p>Tidak ada VA aktif saat ini</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {(activeVas || []).map(va => (
                  <div
                    key={va.id}
                    className="rounded-xl border border-indigo-800/30 bg-indigo-950/30 p-4 hover:bg-indigo-900/20 transition-colors"
                    data-testid={`va-card-${va.id}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <span className="inline-flex px-2 py-0.5 rounded bg-indigo-600/40 text-indigo-200 text-xs font-medium">
                          {va.bankName}
                        </span>
                        <span className={`ml-2 inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          va.vaStatus === 'WAITING_PAYMENT'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-neutral-600/30 text-neutral-300'
                        }`}>
                          {va.vaStatus}
                        </span>
                      </div>
                      <span className="text-xs text-neutral-400">{va.isOpen ? 'Open' : 'Closed'}</span>
                    </div>

                    <div className="flex items-center gap-2 mb-2">
                      <code className="text-lg font-mono font-bold text-neutral-100">{va.vaNumber}</code>
                      <button
                        onClick={() => copyText(va.vaNumber)}
                        className="p-1.5 rounded-lg hover:bg-indigo-800/40 transition-colors"
                        title="Copy VA Number"
                      >
                        <ClipboardCopy size={14} />
                      </button>
                    </div>

                    <div className="text-lg font-semibold mb-2">
                      {va.amount > 0
                        ? va.amount.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
                        : <span className="text-neutral-400">Any Amount</span>
                      }
                    </div>

                    <div className="flex items-center justify-between text-xs text-neutral-400 pt-2 border-t border-indigo-800/20">
                      <span>{va.usernameDisplay || va.playerId || '-'}</span>
                      <span>
                        Exp: {va.expiresAt
                          ? new Date(va.expiresAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
                          : 'Lifetime'
                        }
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
