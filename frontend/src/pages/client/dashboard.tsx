'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/apiClient'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { ClipboardCopy, Wallet, Clock, ListChecks, FileText } from 'lucide-react'

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
      const end = new Date()
      end.setHours(end.getHours() - 3)
      const start = new Date()
      start.setHours(start.getHours() - 6)
      setJakartaRange(start, end)
    } else if (range === '6-12h') {
      const end = new Date()
      end.setHours(end.getHours() - 6)
      const start = new Date()
      start.setHours(start.getHours() - 12)
      setJakartaRange(start, end)
    } else if (range === 'today') {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date()
      setJakartaRange(start, end)
    } else if (range === 'yesterday') {
      const start = new Date()
      start.setDate(start.getDate() - 1)
      start.setHours(0, 0, 0, 0)
      const end = new Date()
      end.setDate(end.getDate() - 1)
      end.setHours(23, 59, 59, 999)
      setJakartaRange(start, end)
    } else if (range === 'week') {
      const start = new Date()
      start.setDate(start.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      const end = new Date()
      setJakartaRange(start, end)
    } else if (range === 'month') {
      const start = new Date()
      start.setDate(start.getDate() - 29)
      start.setHours(0, 0, 0, 0)
      const end = new Date()
      setJakartaRange(start, end)
    } else if (startDate && endDate) {
      const s = new Date(startDate)
      s.setHours(0, 0, 0, 0)
      const e = new Date(endDate)
      e.setHours(23, 59, 59, 999)
      setJakartaRange(s, e)
    }

    if (statusFilter) {
      params.status = statusFilter === 'SUCCESS' ? ['SUCCESS', 'DONE', 'SETTLED'] : statusFilter
    }
    if (selectedChild && selectedChild !== 'all') params.clientId = selectedChild
    if (search.trim()) params.search = search.trim()
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

        const list = Array.isArray(data?.children) ? data.children : []
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
    return () => {
      cancelled = true
    }
  }, []) // intentionally once

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
        children?: ClientOption[]
      }>('/client/dashboard', { params: buildParams() })

      setBalance(Number(data?.balance || 0))
      setTotalPend(Number(data?.totalPending || 0))
      setTotalSettlement(Number(data?.totalSettlement || 0))
      setTotalPaid(Number(data?.totalPaid || 0))
      setTotalTrans(Number(data?.totalCount || 0))

      // FIX: jangan pernah set undefined (biar children.length aman)
      setChildren(Array.isArray(data?.children) ? data.children : [])
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

      const list = Array.isArray(data?.transactions) ? data.transactions : []
      setTxs(list)
      setTotalPages(Math.max(1, Math.ceil((data?.total || 0) / perPage)))
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

      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

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
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      setExporting(false)
    }
  }

  // Copy helper
  const copyText = (txt: string) => {
    navigator.clipboard
      .writeText(txt)
      .then(() => alert('Disalin!'))
      .catch(() => alert('Gagal menyalin'))
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

  useEffect(() => {
    if (!selectedChild) return
    if (['today', 'yesterday', 'week', 'month'].includes(range)) {
      handleExport()
    }
  }, [range])

  const filtered = txs.filter((t) => {
    const q = search.toLowerCase()
    const id = (t?.id ?? '').toLowerCase()
    const rrn = (t?.rrn ?? '').toLowerCase()
    const pid = (t?.playerId ?? '').toLowerCase()

    return (
      (statusFilter === '' || normalizeStatus(t.status) === statusFilter) &&
      (id.includes(q) || rrn.includes(q) || pid.includes(q))
    )
  })

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
        {(children?.length ?? 0) > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-neutral-300">Pilih Child:</span>
            <select
              value={selectedChild}
              onChange={(e) => {
                setSelectedChild(e.target.value as any)
                setPage(1)
              }}
              className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
            >
              <option value="">Pilih Child</option>
              <option value="all">All</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
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
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
                  onChange={(e) => setRange(e.target.value as any)}
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
                        wrapperClassName="w-full"
                        popperClassName="dp-popper-dark"
                        calendarClassName="react-datepicker-dark !border !border-neutral-800 !rounded-xl !shadow-lg"
                        className="dp-input w-full h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm placeholder:text-neutral-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                        weekDayClassName={() => '!text-neutral-400'}
                        dayClassName={(date: Date) => {
                          const isSameDay = (a: Date | null, b: Date | null) =>
                            !!a &&
                            !!b &&
                            a.getFullYear() === b.getFullYear() &&
                            a.getMonth() === b.getMonth() &&
                            a.getDate() === b.getDate()

                          const inRange =
                            startDate &&
                            endDate &&
                            date >
                              new Date(
                                startDate.getFullYear(),
                                startDate.getMonth(),
                                startDate.getDate() - 0,
                                0,
                                0,
                                0,
                                0
                              ) &&
                            date <
                              new Date(
                                endDate.getFullYear(),
                                endDate.getMonth(),
                                endDate.getDate() - 0,
                                23,
                                59,
                                59,
                                999
                              )

                          const isStart = isSameDay(date, startDate)
                          const isEnd = isSameDay(date, endDate)

                          let cls = 'rounded-md hover:!bg-neutral-800 transition-colors'
                          if (inRange) cls += ' !rounded-none'
                          if (isStart) cls += ' !rounded-l-md'
                          if (isEnd) cls += ' !rounded-r-md'
                          return cls
                        }}
                        renderCustomHeader={({
                          date,
                          decreaseMonth,
                          increaseMonth,
                          prevMonthButtonDisabled,
                          nextMonthButtonDisabled,
                        }) => (
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
                  {exporting ? 'Exporting…' : (
                    <>
                      <FileText size={16} /> Export Excel
                    </>
                  )}
                </button>
              </div>

              {/* Status */}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value)
                    setPage(1)
                  }}
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
                  onChange={(e) => setSearch(e.target.value)}
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
                <table className="min-w-[1200px] w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
                      {[
                        'Date',
                        'Update At',
                        'Settled At',
                        'TRX ID',
                        'RRN',
                        'Player ID',
                        'Amount',
                        'Fee',
                        'Net Amount',
                        'Status',
                        'Settlement Status',
                        'Action',
                      ].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-neutral-300">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr
                        key={t.id}
                        className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900/60"
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(t.date).toLocaleString('id-ID', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {t.paymentReceivedTime
                            ? new Date(t.paymentReceivedTime).toLocaleString('id-ID', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })
                            : '-'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {t.settlementTime
                            ? new Date(t.settlementTime).toLocaleString('id-ID', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })
                            : '-'}
                        </td>

                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[12px]">
                              {t.id}
                            </code>
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
                  onChange={(e) => {
                    setPerPage(+e.target.value)
                    setPage(1)
                  }}
                  className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 px-2 text-sm"
                >
                  {[10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-neutral-800 px-2.5 disabled:opacity-50 hover:bg-neutral-800/60"
                >
                  ‹
                </button>
                <span className="min-w-[70px] text-center">
                  {page}/{totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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

      {/* Portal target untuk react-datepicker agar popper gak ketutup */}
      <div id="dp-portal" className="relative z-[9999]" />
    </div>
  )
}
