'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/apiClient'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { 
  CreditCard, RefreshCw, CheckCircle2, Timer, XCircle, 
  ChevronLeft, ChevronRight, Filter, Download, Search,
  Building2, Clock, TrendingUp, ArrowLeft, Copy, Eye,
  Loader2, ChevronDown, AlertCircle
} from 'lucide-react'

// Bank name mapping
const BANK_NAMES: Record<string, string> = {
  'MANDIRI': 'Bank Mandiri',
  'BRI': 'Bank BRI',
  'BNI': 'Bank BNI',
  'PERMATA': 'Bank Permata',
  'CIMB': 'Bank CIMB Niaga',
  'BCA': 'Bank BCA',
  'DANAMON': 'Bank Danamon',
  'SAHABAT_SAMPOERNA': 'Bank Sahabat Sampoerna',
}

// Types
type VATransaction = {
  id: string
  date: string
  vaNumber: string
  bankCode: string
  bankName: string
  playerId: string
  usernameDisplay: string
  amount: number
  feeLauncx: number
  netSettle: number
  status: string
  settlementStatus: string
  paymentReceivedTime: string
  trxExpirationTime: string
}

type VAStats = {
  total: number
  pending: number
  success: number
  expired: number
  totalAmount: number
  totalPaid: number
}

type ClientOption = { id: string; name: string }

// Status badge component
const StatusBadge = ({ status }: { status: string }) => {
  const normalized = ['DONE', 'SETTLED', 'LN_SETTLED'].includes(status) ? 'SUCCESS' : status
  
  switch (normalized) {
    case 'SUCCESS':
      return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"><CheckCircle2 size={12} /> Success</span>
    case 'PAID':
      return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30"><CheckCircle2 size={12} /> Paid</span>
    case 'PENDING':
      return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30"><Timer size={12} /> Pending</span>
    case 'EXPIRED':
      return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30"><XCircle size={12} /> Expired</span>
    default:
      return <span className="text-neutral-400 text-xs">{status || '-'}</span>
  }
}

// Format currency
const formatIDR = (n: number) => n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })

// Copy to clipboard with feedback
const useCopyFeedback = () => {
  const [copied, setCopied] = useState<string | null>(null)
  
  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }
  
  return { copied, copy }
}

export default function VADashboardPage() {
  const router = useRouter()
  const { copied, copy } = useCopyFeedback()
  
  // Data state
  const [transactions, setTransactions] = useState<VATransaction[]>([])
  const [stats, setStats] = useState<VAStats>({ total: 0, pending: 0, success: 0, expired: 0, totalAmount: 0, totalPaid: 0 })
  const [children, setChildren] = useState<ClientOption[]>([])
  
  // UI state
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  
  // Filter state
  const [selectedChild, setSelectedChild] = useState('all')
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [bankFilter, setBankFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState<Date | null>(null)
  const [dateTo, setDateTo] = useState<Date | null>(null)
  
  // Pagination state (cursor-based)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  
  // Debounce search
  const searchTimeout = useRef<NodeJS.Timeout>()
  
  // Fetch VA data
  const fetchVAData = useCallback(async (cursor?: string, append = false) => {
    try {
      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }
      
      const params: any = {
        limit: 20,
        ...(cursor && { cursor }),
        ...(selectedChild !== 'all' && { clientId: selectedChild }),
        ...(statusFilter.length > 0 && { status: statusFilter }),
        ...(bankFilter && { bankCode: bankFilter }),
        ...(searchQuery && { search: searchQuery }),
        ...(dateFrom && { date_from: dateFrom.toISOString() }),
        ...(dateTo && { date_to: dateTo.toISOString() }),
      }
      
      const res = await api.get('/client/va-dashboard', { params })
      const data = res.data
      
      if (append) {
        setTransactions(prev => [...prev, ...data.transactions])
      } else {
        setTransactions(data.transactions || [])
      }
      
      setStats(data.stats || { total: 0, pending: 0, success: 0, expired: 0, totalAmount: 0, totalPaid: 0 })
      setChildren(data.children || [])
      setNextCursor(data.nextCursor || null)
      setHasMore(data.hasMore || false)
      setTotalCount(data.total || data.stats?.total || 0)
      
    } catch (err: any) {
      if (err?.response?.status === 401) {
        router.push('/client/login')
      }
      console.error('Failed to fetch VA data:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
    }
  }, [selectedChild, statusFilter, bankFilter, searchQuery, dateFrom, dateTo, router])
  
  // Initial load and filter changes
  useEffect(() => {
    fetchVAData()
  }, [selectedChild, statusFilter, bankFilter, dateFrom, dateTo])
  
  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      fetchVAData()
    }, 500)
    return () => clearTimeout(searchTimeout.current)
  }, [searchQuery])
  
  // Load more handler
  const loadMore = () => {
    if (nextCursor && hasMore && !loadingMore) {
      fetchVAData(nextCursor, true)
    }
  }
  
  // Refresh handler
  const handleRefresh = () => {
    setRefreshing(true)
    setNextCursor(null)
    fetchVAData()
  }
  
  // Export handler
  const handleExport = async () => {
    try {
      const params: any = {
        ...(selectedChild !== 'all' && { clientId: selectedChild }),
        ...(statusFilter.length > 0 && { status: statusFilter }),
        ...(bankFilter && { bankCode: bankFilter }),
        ...(dateFrom && { date_from: dateFrom.toISOString() }),
        ...(dateTo && { date_to: dateTo.toISOString() }),
        channel: 'VA_DANARAPAY',
      }
      
      const res = await api.get('/client/dashboard/export', { params, responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `va-transactions-${new Date().toISOString().split('T')[0]}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      console.error('Export failed:', err)
    }
  }
  
  // Format date
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('id-ID', { 
      dateStyle: 'short', 
      timeStyle: 'short' 
    })
  }
  
  return (
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/client/overview')}
            className="mb-4 flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} /> Kembali ke Overview
          </button>
          
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/30 flex items-center justify-center">
                  <CreditCard className="text-indigo-400" size={22} />
                </div>
                Virtual Account Dashboard
              </h1>
              <p className="text-sm text-neutral-400 mt-1 ml-13">
                Monitor semua transaksi VA DanaRapay
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-700 hover:bg-neutral-800 disabled:opacity-50 text-sm"
                data-testid="refresh-btn"
              >
                <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                Refresh
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-sm"
                data-testid="export-btn"
              >
                <Download size={16} />
                Export
              </button>
            </div>
          </div>
        </div>
        
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-neutral-400 uppercase tracking-wide">Total VA</span>
              <CreditCard size={16} className="text-neutral-500" />
            </div>
            <div className="text-2xl font-bold">{stats.total.toLocaleString()}</div>
          </div>
          
          <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-amber-300 uppercase tracking-wide">Pending</span>
              <Timer size={16} className="text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-amber-300">{stats.pending.toLocaleString()}</div>
          </div>
          
          <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-emerald-300 uppercase tracking-wide">Success</span>
              <CheckCircle2 size={16} className="text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-300">{stats.success.toLocaleString()}</div>
          </div>
          
          <div className="rounded-xl border border-indigo-800/50 bg-indigo-950/20 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-indigo-300 uppercase tracking-wide">Total Paid</span>
              <TrendingUp size={16} className="text-indigo-400" />
            </div>
            <div className="text-xl font-bold text-indigo-300">{formatIDR(stats.totalPaid)}</div>
          </div>
        </div>
        
        {/* Filters */}
        <div className="mb-6 p-4 rounded-xl border border-neutral-800 bg-neutral-900/50">
          <div className="flex items-center gap-2 mb-3">
            <Filter size={16} className="text-neutral-400" />
            <span className="text-sm font-medium">Filter</span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Client selector */}
            {children.length > 0 && (
              <select
                value={selectedChild}
                onChange={e => setSelectedChild(e.target.value)}
                className="h-10 rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm"
                data-testid="client-filter"
              >
                <option value="all">Semua Client</option>
                {children.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            
            {/* Status filter */}
            <select
              value={statusFilter[0] || ''}
              onChange={e => setStatusFilter(e.target.value ? [e.target.value] : [])}
              className="h-10 rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm"
              data-testid="status-filter"
            >
              <option value="">Semua Status</option>
              <option value="PENDING">Pending</option>
              <option value="PAID">Paid</option>
              <option value="SUCCESS">Success</option>
              <option value="EXPIRED">Expired</option>
            </select>
            
            {/* Bank filter */}
            <select
              value={bankFilter}
              onChange={e => setBankFilter(e.target.value)}
              className="h-10 rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm"
              data-testid="bank-filter"
            >
              <option value="">Semua Bank</option>
              {Object.entries(BANK_NAMES).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
            
            {/* Date from */}
            <div className="relative">
              <DatePicker
                selected={dateFrom}
                onChange={setDateFrom}
                dateFormat="dd/MM/yyyy"
                placeholderText="Dari tanggal"
                className="h-10 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm"
                data-testid="date-from"
              />
            </div>
            
            {/* Date to */}
            <div className="relative">
              <DatePicker
                selected={dateTo}
                onChange={setDateTo}
                dateFormat="dd/MM/yyyy"
                placeholderText="Sampai tanggal"
                className="h-10 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm"
                data-testid="date-to"
              />
            </div>
          </div>
          
          {/* Search */}
          <div className="mt-3 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari berdasarkan ID atau Player ID..."
              className="w-full h-10 pl-10 pr-4 rounded-lg border border-neutral-700 bg-neutral-800 text-sm"
              data-testid="search-input"
            />
          </div>
        </div>
        
        {/* Transaction Table */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-neutral-400" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
              <AlertCircle size={40} className="mb-3" />
              <p>Tidak ada transaksi VA</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-800/50 border-b border-neutral-700">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-neutral-300">Tanggal</th>
                      <th className="text-left px-4 py-3 font-medium text-neutral-300">VA Number</th>
                      <th className="text-left px-4 py-3 font-medium text-neutral-300">Bank</th>
                      <th className="text-left px-4 py-3 font-medium text-neutral-300">Player</th>
                      <th className="text-right px-4 py-3 font-medium text-neutral-300">Amount</th>
                      <th className="text-center px-4 py-3 font-medium text-neutral-300">Status</th>
                      <th className="text-center px-4 py-3 font-medium text-neutral-300">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {transactions.map(tx => (
                      <>
                        <tr 
                          key={tx.id}
                          className="hover:bg-neutral-800/50 transition-colors cursor-pointer"
                          onClick={() => setExpandedRow(expandedRow === tx.id ? null : tx.id)}
                        >
                          <td className="px-4 py-3">
                            <div className="text-white">{formatDate(tx.date)}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <code className="bg-neutral-800 px-2 py-0.5 rounded text-xs">{tx.vaNumber || '-'}</code>
                              {tx.vaNumber && (
                                <button 
                                  onClick={e => { e.stopPropagation(); copy(tx.vaNumber, tx.id) }}
                                  className="text-neutral-400 hover:text-white"
                                  title="Copy VA Number"
                                >
                                  {copied === tx.id ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Building2 size={14} className="text-neutral-400" />
                              <span>{tx.bankName || tx.bankCode || '-'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-neutral-300">{tx.playerId || '-'}</div>
                            {tx.usernameDisplay && (
                              <div className="text-xs text-neutral-500">{tx.usernameDisplay}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="font-medium">{formatIDR(tx.amount)}</div>
                            {tx.status === 'SUCCESS' || tx.status === 'PAID' ? (
                              <div className="text-xs text-emerald-400">Net: {formatIDR(tx.netSettle)}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <StatusBadge status={tx.status} />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <ChevronDown 
                              size={16} 
                              className={`text-neutral-400 transition-transform ${expandedRow === tx.id ? 'rotate-180' : ''}`} 
                            />
                          </td>
                        </tr>
                        
                        {/* Expanded row */}
                        {expandedRow === tx.id && (
                          <tr className="bg-neutral-800/30">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <div>
                                  <div className="text-neutral-400 text-xs mb-1">Transaction ID</div>
                                  <code className="text-xs bg-neutral-800 px-2 py-1 rounded">{tx.id}</code>
                                </div>
                                <div>
                                  <div className="text-neutral-400 text-xs mb-1">Fee Launcx</div>
                                  <div className="font-medium">{formatIDR(tx.feeLauncx)}</div>
                                </div>
                                <div>
                                  <div className="text-neutral-400 text-xs mb-1">Payment Time</div>
                                  <div className="flex items-center gap-1">
                                    <Clock size={12} className="text-neutral-400" />
                                    {tx.paymentReceivedTime ? formatDate(tx.paymentReceivedTime) : '-'}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-neutral-400 text-xs mb-1">Expiry</div>
                                  <div className="flex items-center gap-1">
                                    <Timer size={12} className="text-neutral-400" />
                                    {tx.trxExpirationTime ? formatDate(tx.trxExpirationTime) : '-'}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-neutral-800">
                {transactions.map(tx => (
                  <div key={tx.id} className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="text-xs text-neutral-400">{formatDate(tx.date)}</div>
                        <div className="font-medium mt-1">{formatIDR(tx.amount)}</div>
                      </div>
                      <StatusBadge status={tx.status} />
                    </div>
                    
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-400">VA Number</span>
                        <code className="bg-neutral-800 px-2 py-0.5 rounded text-xs">{tx.vaNumber || '-'}</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-400">Bank</span>
                        <span>{tx.bankName || tx.bankCode || '-'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-400">Player</span>
                        <span>{tx.playerId || '-'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          
          {/* Load More */}
          {hasMore && !loading && (
            <div className="border-t border-neutral-800 p-4 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-6 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm disabled:opacity-50 inline-flex items-center gap-2"
                data-testid="load-more-btn"
              >
                {loadingMore ? (
                  <><Loader2 size={16} className="animate-spin" /> Loading...</>
                ) : (
                  <>Load More ({totalCount - transactions.length} remaining)</>
                )}
              </button>
            </div>
          )}
        </div>
        
        {/* Footer info */}
        <div className="mt-4 text-center text-sm text-neutral-500">
          Menampilkan {transactions.length} dari {totalCount} transaksi
        </div>
      </div>
    </div>
  )
}
