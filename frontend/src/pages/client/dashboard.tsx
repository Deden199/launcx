'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/apiClient'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { ClipboardCopy, Wallet, Clock, ListChecks, FileText, CreditCard, Building2, RefreshCw } from 'lucide-react'

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
  // VA fields
  channel?: string
  vaNumber?: string
  bankCode?: string
  bankName?: string
}

type VaStats = {
  created: number
  pending: number
  success: number
  expired: number
  totalAmount: number
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

  // VA Stats & Active VAs
  const [vaStats, setVaStats] = useState<VaStats>({ created: 0, pending: 0, success: 0, expired: 0, totalAmount: 0 })
  const [vaBanks, setVaBanks] = useState<VaBank[]>([])
  const [activeVas, setActiveVas] = useState<ActiveVa[]>([])
  const [loadingVa, setLoadingVa] = useState(false)
  const [showVaSection, setShowVaSection] = useState(false)

  // Channel & Bank filters
  const [channelFilter, setChannelFilter] = useState<string>('')
  const [bankFilter, setBankFilter] = useState<string>('')

  // Date filter
  const [range, setRange] = useState<
    '1-3h' | '3-6h' | '6-12h' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'
  >('1-3h')
    const [statusFilter, setStatusFilter] = useState<string>('PAID') // default PAID

  // Search
  const [search, setSearch] = useState('')

  // helper: normalisasi DONE / SETTLED => SUCCESS
  const normalizeStatus = (s: string): string => (s === 'DONE' || s === 'SETTLED' ? 'SUCCESS' : s)

  const handleApply = () => {
   if (!selectedChild) return
    fetchSummary()
    fetchTransactions()
  }

  const buildParams = () => {
    const tz = 'Asia/Jakarta'
    const params: any = {}

    const setJakartaRange = (start: Date, end: Date) => {

      const startJakarta = new Date(start.toLocaleString('en-US', { timeZone: tz }))
      const endJakarta = new Date(end.toLocaleString('en-US', { timeZone: tz }))
      params.date_from = startJakarta.toISOString()
      params.date_to = endJakarta.toISOString()
          }

    if (range === '1-3h') {
      const end = new Date()
      const start = new Date()
      start.setHours(start.getHours() - 3)
      setJakartaRange(start, end)
    } else if (range === '3-6h') {
      const end = new Date(); end.setHours(end.getHours() - 3)
      const start = new Date(); start.setHours(start.getHours() - 6)
      setJakartaRange(start, end)
    } else if (range === '6-12h') {
      const end = new Date(); end.setHours(end.getHours() - 6)
      const start = new Date(); start.setHours(start.getHours() - 12)
      setJakartaRange(start, end)
    } else if (range === 'today') {
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const end = new Date()
      setJakartaRange(start, end)
    } else if (range === 'yesterday') {
      const start = new Date(); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0)
      const end = new Date(); end.setDate(end.getDate() - 1); end.setHours(23, 59, 59, 999)
      setJakartaRange(start, end)
    } else if (range === 'week') {
      const start = new Date(); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0)
      const end = new Date()
      setJakartaRange(start, end)
    } else if (range === 'month') {
      const start = new Date(); start.setDate(start.getDate() - 29); start.setHours(0, 0, 0, 0)
      const end = new Date()
      setJakartaRange(start, end)
    } else if (startDate && endDate) {
      const s = new Date(startDate); s.setHours(0, 0, 0, 0)
      const e = new Date(endDate); e.setHours(23, 59, 59, 999)
      setJakartaRange(s, e)

    }

    if (statusFilter) {
      params.status = statusFilter === 'SUCCESS' ? ['SUCCESS', 'DONE', 'SETTLED'] : statusFilter
    }
    if (selectedChild && selectedChild !== 'all') params.clientId = selectedChild
    if (search.trim()) params.search = search.trim()
    // Channel & Bank filters
    if (channelFilter) params.channel = channelFilter
    if (bankFilter) params.bankCode = bankFilter
    params.page = page
    params.limit = perPage
    return params
  }

// Fetch children list (once)
  useEffect(() => {
    let cancelled = false
    const loadChildren = async () => {
      try {
        const { data } = await api.get<{ children: ClientOption[] }>('/client/dashboard')
        if (cancelled) return

        const list = data.children || []
        setChildren(list)

        // Jika akun child (tanpa daftar child), langsung set ke "all" supaya data tetap termuat
        if (list.length === 0 && selectedChild === '') {
          setSelectedChild('all')
        }
      } catch (err) {
        console.error('Failed to fetch children', err)
      }
    }

    loadChildren()
    return () => { cancelled = true }
  }, [])

  // Fetch summary (with children)
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
        vaStats?: VaStats
        vaBanks?: VaBank[]
      }>('/client/dashboard', { params: buildParams() })

      setBalance(data.balance)
      setTotalPend(data.totalPending)
      setTotalSettlement(data.totalSettlement || 0)
      setTotalPaid(data.totalPaid || 0)
      setChildren(data.children)
      setTotalTrans(data.totalCount)
      // VA Stats
      if (data.vaStats) setVaStats(data.vaStats)
      if (data.vaBanks) setVaBanks(data.vaBanks)
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

  // Fetch Active VAs
  const fetchActiveVas = async () => {
    if (!selectedChild) return
    setLoadingVa(true)
    try {
      const params: any = {}
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

  // Fetch transactions
  const fetchTransactions = async () => {
        if (!selectedChild) {
      setTxs([])
      setTotalPages(1)
      setLoadingTx(false)
      return
    }


    setLoadingTx(true)
    try {
      const { data } = await api.get<{ transactions: Tx[]; total: number }>(
        '/client/dashboard',
        { params: buildParams() }
      )
      setTxs(data.transactions)
      setTotalPages(Math.max(1, Math.ceil(data.total / perPage)))
    } catch (err: any) {
      if (err?.response?.status === 401) {
        router.push('/client/login')
      } else {
        console.error('Failed to fetch transactions', err)
      }
    } finally {
      setLoadingTx(false)
    }
  }

  // Export Excel
  const handleExport = async () => {
    const token = localStorage.getItem('clientToken')
    if (!token) return router.push('/client/login')

    setExporting(true)
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    try {
      const controller = new AbortController()
      timeoutId = setTimeout(() => controller.abort(), 60000)

      const resp = await api.get('/client/dashboard/export', {
        params: buildParams(),
        responseType: 'blob',
        signal: controller.signal,
        timeout: 0,
      })

      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }

      const contentDisp = (resp as any).headers?.['content-disposition'] || ''
      const match = /filename="?([^"]+)"?/.exec(contentDisp)
      const filename = match ? match[1] : 'client-transactions.xlsx'

      const blob = new Blob([resp.data], {
        type: (resp as any).headers?.['content-type'] || undefined,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      if (e?.name === 'CanceledError' || e?.name === 'AbortError') {
        alert('Export timeout. Coba range lebih kecil atau gunakan export background.')
      } else {
        console.error('Export failed', e)
        alert('Gagal export data: ' + (e?.message || 'Unknown error'))
      }
    } finally {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
      setExporting(false)
    }
  }

  // Copy helper
  const copyText = (txt: string) => {
    navigator.clipboard.writeText(txt)
      .then(() => alert('Disalin!'))
      .catch(() => alert('Gagal menyalin'))
  }

  // Trigger fetches when filters change
  useEffect(() => {
        if (!selectedChild) return

    if (range !== 'custom' || (startDate && endDate)) fetchSummary()
  }, [range, selectedChild, startDate, endDate, statusFilter, channelFilter, bankFilter])
  useEffect(() => {
        if (!selectedChild) return

    if (range !== 'custom' || (startDate && endDate)) fetchTransactions()
  }, [range, selectedChild, startDate, endDate, search, page, perPage, statusFilter, channelFilter, bankFilter])
  useEffect(() => {
        if (!selectedChild) return

    if (['today', 'yesterday', 'week', 'month'].includes(range)) {
      handleExport()
    }
  }, [range])
  
  // Fetch active VAs when section is shown
  useEffect(() => {
    if (showVaSection && selectedChild) {
      fetchActiveVas()
    }
  }, [showVaSection, selectedChild, bankFilter])

  const filtered = txs.filter(t =>
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
    // Paksa dark mode
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
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

        {!selectedChild && (
          <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 text-sm text-neutral-300">
            Pilih child terlebih dahulu untuk memuat data transaksi dan ringkasan.
          </div>
        )}

        {/* Stats */}
        {selectedChild && (
        <section className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-neutral-400">Transactions</div>
                <div className="mt-1 text-xl font-semibold">{totalTrans.toLocaleString()}</div>
              </div>
              <ListChecks className="opacity-80" />
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-neutral-400">Pending Settlement</div>
                <div className="mt-1 text-xl font-semibold">
                  {totalPend.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
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
                  {totalSettlement.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                </div>
              </div>
              <Wallet className="opacity-80" />
            </div>
          </div>

          {/* VA DanaRapay Stats */}
          <div className="rounded-2xl border border-indigo-800/50 bg-indigo-950/30 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-indigo-300 font-medium">VA DanaRapay</div>
              <CreditCard className="opacity-80 text-indigo-400" size={18} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-neutral-400">Pending:</span>
                <span className="ml-1 text-amber-400 font-medium">{vaStats.pending}</span>
              </div>
              <div>
                <span className="text-neutral-400">Success:</span>
                <span className="ml-1 text-emerald-400 font-medium">{vaStats.success}</span>
              </div>
              <div>
                <span className="text-neutral-400">Expired:</span>
                <span className="ml-1 text-red-400 font-medium">{vaStats.expired}</span>
              </div>
              <div>
                <span className="text-neutral-400">Total:</span>
                <span className="ml-1 font-medium">{vaStats.created}</span>
              </div>
            </div>
          </div>
        </section>
        )}

        {/* Filters */}
                {selectedChild && (

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-sm mb-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {/* Range */}
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Rentang</span>
              <select
                value={range}
                onChange={e => setRange(e.target.value as any)}
                className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
              >
                <option value="1-3h">1–3 Jam</option>
                <option value="3-6h">3–6 Jam</option>
                <option value="6-12h">6–12 Jam</option>
                <option value="today">1 Hari (auto export)</option>
                <option value="yesterday">Yesterday (auto export)</option>
                <option value="week">7 Day (auto export)</option>
                <option value="month">30 Day (auto export)</option>
                <option value="custom">Custom</option>
              </select>
            </label>

            {/* Custom Date */}
            {range === 'custom' && (
              <div className="lg:col-span-2">
                <span className="mb-1 block text-xs text-neutral-400">Tanggal</span>
                <div className="flex items-center gap-2">
                  <div className="relative w-full">
<DatePicker
  selectsRange
  startDate={startDate}
  endDate={endDate}
  onChange={(upd: [Date | null, Date | null]) => setDateRange(upd)}
  isClearable={false}
  placeholderText="Select Date Range…"
  maxDate={new Date()}
  dateFormat="dd-MM-yyyy"
  popperPlacement="bottom-start"
  showPopperArrow={false}
  portalId="dp-portal"

  /* Wrapper & popper classes */
  wrapperClassName="w-full"
  popperClassName="dp-popper-dark"

  /* Calendar base — cukup minimal, selebihnya di CSS file */
  calendarClassName="react-datepicker-dark !border !border-neutral-800 !rounded-xl !shadow-lg"

  /* Input look & focus */
  className="dp-input w-full h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm placeholder:text-neutral-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"

  /* Weekday label */
  weekDayClassName={() => '!text-neutral-400'}

  /* Day cell class dengan logika range, tetap manfaatkan CSS bawaan DP untuk state, plus hover */
  dayClassName={(date: Date) => {
    const isSameDay = (a: Date | null, b: Date | null) =>
      !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

    const inRange =
      startDate && endDate && date > new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()-0, 0,0,0,0) &&
      date < new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()-0, 23,59,59,999)

    const isStart = isSameDay(date, startDate)
    const isEnd = isSameDay(date, endDate)

    // Tambah hover & rounding halus; warna utamanya dikendalikan oleh CSS global
    let cls = 'rounded-md hover:!bg-neutral-800 transition-colors'

    // Bikin range tengah flat (dibulatkan oleh start/end)
    if (inRange) cls += ' !rounded-none'

    // Pastikan cap kiri/kanan tetap rounded enak
    if (isStart) cls += ' !rounded-l-md'
    if (isEnd) cls += ' !rounded-r-md'

    return cls
  }}

  /* Custom header kamu sudah oke; tambahkan sedikit padding agar napas */
  renderCustomHeader={({ date, decreaseMonth, increaseMonth, prevMonthButtonDisabled, nextMonthButtonDisabled }) => (
    <div className="flex items-center justify-between px-2 pt-2 pb-3">
      <button
        type="button"
        onClick={decreaseMonth}
        disabled={prevMonthButtonDisabled}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 hover:bg-neutral-800/60 disabled:opacity-40"
      >
        ‹
      </button>
      <div className="text-sm font-medium">
        {date.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}
      </div>
      <button
        type="button"
        onClick={increaseMonth}
        disabled={nextMonthButtonDisabled}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 hover:bg-neutral-800/60 disabled:opacity-40"
      >
        ›
      </button>
    </div>
  )}
/>

                  </div>
                  {(startDate || endDate) && (
                    <button
                      type="button"
                      className="h-10 rounded-xl border border-neutral-800 px-3 text-sm hover:bg-neutral-800/60"
                      onClick={() => setDateRange([null, null])}
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    className="h-10 rounded-xl bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    onClick={handleApply}
                    disabled={!startDate || !endDate}
                  >
                    Terapkan
                  </button>
                </div>
              </div>
            )}

            {/* Export */}
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                aria-busy={exporting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-800 px-3 py-2.5 text-sm font-medium hover:bg-neutral-800/60 disabled:opacity-50"
              >
                {exporting ? 'Exporting…' : (<><FileText size={16} /> Export Excel</>)}
              </button>
            </div>

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

            {/* Channel Filter */}
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Channel</span>
              <select
                data-testid="channel-filter"
                value={channelFilter}
                onChange={e => { setChannelFilter(e.target.value); setPage(1) }}
                className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
              >
                <option value="">All Channels</option>
                <option value="QRIS">QRIS</option>
                <option value="VA_DANARAPAY">VA DanaRapay</option>
              </select>
            </label>

            {/* Bank Filter (only for VA) */}
            {channelFilter === 'VA_DANARAPAY' && (
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Bank VA</span>
                <select
                  data-testid="bank-filter"
                  value={bankFilter}
                  onChange={e => { setBankFilter(e.target.value); setPage(1) }}
                  className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
                >
                  <option value="">All Banks</option>
                  {(vaBanks || []).map(b => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
              </label>
            )}

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
          </div>
        </section>
        )}

        {/* Table */}
                {selectedChild && (

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Transaction List &amp; Settlement</h2>
            {!loadingTx && (
              <div className="text-xs text-neutral-400">
                {filtered.length ? `${filtered.length.toLocaleString('id-ID')} baris` : '—'}
              </div>
            )}
          </div>

          {loadingTx ? (
            <div className="grid gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-neutral-800" />
              ))}
              <div className="sr-only">Loading transactions…</div>
            </div>
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <table className="min-w-[1400px] w-full text-sm" data-testid="transactions-table">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
                    {[
                      'Date', 'Channel', 'VA/Bank', 'TRX ID', 'RRN', 'Player ID',
                      'Amount', 'Fee', 'Net Amount', 'Status', 'Settlement Status', 'Action',
                    ].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-neutral-300">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900/60">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(t.date).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      
                      {/* Channel */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          t.channel === 'VA_DANARAPAY' 
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' 
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        }`}>
                          {t.channel === 'VA_DANARAPAY' ? (
                            <><CreditCard size={12} /> VA</>
                          ) : (
                            'QRIS'
                          )}
                        </span>
                      </td>

                      {/* VA Number / Bank */}
                      <td className="px-3 py-2">
                        {t.channel === 'VA_DANARAPAY' && t.vaNumber ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <code className="text-[11px] text-neutral-300">{t.vaNumber}</code>
                              <button
                                title="Copy VA Number"
                                onClick={() => copyText(t.vaNumber || '')}
                                className="inline-flex h-5 w-5 items-center justify-center rounded border border-neutral-700 hover:bg-neutral-800/60"
                              >
                                <ClipboardCopy size={10} />
                              </button>
                            </div>
                            <span className="text-[10px] text-neutral-500">{t.bankName || t.bankCode}</span>
                          </div>
                        ) : (
                          <span className="text-neutral-500">-</span>
                        )}
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
                        {t.settlementStatus === 'WAITING'
                          ? 'PENDING'
                          : t.settlementStatus === 'UNSUCCESSFUL'
                          ? 'FAILED'
                          : t.settlementStatus || '-'}
                      </td>

                      <td className="px-3 py-2">—</td>
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

        {/* VA Aktif Section */}
        {selectedChild && (
          <section className="mt-6 rounded-2xl border border-indigo-800/40 bg-indigo-950/20 p-4 sm:p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <button
                data-testid="toggle-va-section"
                onClick={() => setShowVaSection(!showVaSection)}
                className="flex items-center gap-2 text-base font-semibold text-indigo-200 hover:text-indigo-100"
              >
                <Building2 size={18} />
                <span>VA Aktif (Monitoring)</span>
                <span className={`transition-transform ${showVaSection ? 'rotate-180' : ''}`}>▼</span>
              </button>
              {showVaSection && (
                <button
                  onClick={fetchActiveVas}
                  disabled={loadingVa}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-indigo-700/50 hover:bg-indigo-800/30 disabled:opacity-50"
                >
                  <RefreshCw size={12} className={loadingVa ? 'animate-spin' : ''} />
                  Refresh
                </button>
              )}
            </div>

            {showVaSection && (
              <div className="space-y-3">
                {loadingVa ? (
                  <div className="grid gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-16 w-full animate-pulse rounded-lg bg-indigo-900/30" />
                    ))}
                  </div>
                ) : activeVas.length === 0 ? (
                  <div className="text-center py-6 text-neutral-400 text-sm">
                    Tidak ada VA aktif saat ini
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {activeVas.map(va => (
                      <div 
                        key={va.id} 
                        className="rounded-xl border border-indigo-800/30 bg-indigo-950/40 p-3 hover:bg-indigo-900/30 transition-colors"
                        data-testid={`va-card-${va.id}`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs px-2 py-0.5 rounded bg-indigo-600/30 text-indigo-200 font-medium">
                                {va.bankName}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                va.vaStatus === 'WAITING_PAYMENT' 
                                  ? 'bg-amber-500/20 text-amber-300' 
                                  : 'bg-neutral-600/30 text-neutral-300'
                              }`}>
                                {va.vaStatus}
                              </span>
                            </div>
                            <div className="mt-1 font-mono text-sm text-neutral-100 flex items-center gap-1">
                              {va.vaNumber}
                              <button
                                onClick={() => copyText(va.vaNumber)}
                                className="ml-1 p-1 rounded hover:bg-indigo-800/40"
                                title="Copy VA Number"
                              >
                                <ClipboardCopy size={12} />
                              </button>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-neutral-400">{va.isOpen ? 'Open' : 'Closed'}</div>
                            <div className="font-semibold text-sm">
                              {va.amount > 0 
                                ? va.amount.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })
                                : 'Any Amount'
                              }
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-neutral-400 pt-2 border-t border-indigo-800/20">
                          <span>{va.usernameDisplay || va.playerId}</span>
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
              </div>
            )}
          </section>
        )}

      </div>

      {/* Portal target untuk react-datepicker agar popper gak ketutup */}
      <div id="dp-portal" className="relative z-[9999]" />
    </div>
  )
}
