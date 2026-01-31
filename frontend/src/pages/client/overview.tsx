'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/apiClient'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { 
  Wallet, Clock, ArrowDownToLine, ArrowUpFromLine, CreditCard, 
  QrCode, RefreshCw, TrendingUp, CheckCircle2, Timer, XCircle,
  ChevronLeft, ChevronRight, Building2, History, Filter, Download,
  BarChart3, Eye, ClipboardCopy
} from 'lucide-react'

// Types
type ClientOption = { id: string; name: string; balance?: number }

type FlowSummary = {
  vaCreated: number
  vaPaid: number
  vaAmount: number
  qrisCreated: number
  qrisPaid: number
  qrisAmount: number
  totalIncome: number
  totalWithdrawn: number
  pendingWithdrawal: number
  availableBalance: number
  pendingSettlement: number
}

type RecentTransaction = {
  id: string
  type: 'VA' | 'QRIS'
  status: string
  amount: number
  netAmount: number
  date: string
  reference: string
  bankName?: string
  vaNumber?: string
}

type RecentWithdrawal = {
  refId: string
  amount: number
  netAmount: number
  status: string
  bankName: string
  accountNumber: string
  createdAt: string
}

// Status badge component
const StatusBadge = ({ status }: { status: string }) => {
  const normalized = ['DONE', 'SETTLED', 'LN_SETTLED'].includes(status) ? 'SUCCESS' : status
  
  switch (normalized) {
    case 'SUCCESS':
    case 'COMPLETED':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300"><CheckCircle2 size={10} /> {normalized}</span>
    case 'PAID':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300"><CheckCircle2 size={10} /> PAID</span>
    case 'PENDING':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300"><Timer size={10} /> PENDING</span>
    case 'EXPIRED':
    case 'FAILED':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-300"><XCircle size={10} /> {normalized}</span>
    default:
      return <span className="text-neutral-400 text-xs">{status || '-'}</span>
  }
}

// Format currency
const formatIDR = (n: number) => n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })

export default function ClientOverviewPage() {
  const router = useRouter()
  
  // State
  const [children, setChildren] = useState<ClientOption[]>([])
  const [selectedChild, setSelectedChild] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  
  // Flow summary
  const [summary, setSummary] = useState<FlowSummary>({
    vaCreated: 0, vaPaid: 0, vaAmount: 0,
    qrisCreated: 0, qrisPaid: 0, qrisAmount: 0,
    totalIncome: 0, totalWithdrawn: 0, pendingWithdrawal: 0,
    availableBalance: 0, pendingSettlement: 0,
  })
  
  // Recent activity
  const [recentTx, setRecentTx] = useState<RecentTransaction[]>([])
  const [recentWd, setRecentWd] = useState<RecentWithdrawal[]>([])
  
  // Date range
  const [range, setRange] = useState<'today' | 'week' | 'month'>('today')
  
  // Calculate date range
  const getDateRange = useCallback(() => {
    const now = new Date()
    let from: Date
    
    switch (range) {
      case 'today':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        break
      case 'week':
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
    }
    
    return { date_from: from.toISOString(), date_to: now.toISOString() }
  }, [range])
  
  // Fetch overview data
  const fetchOverview = useCallback(async () => {
    try {
      const params = {
        ...getDateRange(),
        clientId: selectedChild !== 'all' ? selectedChild : undefined,
      }
      
      // Parallel fetch: VA stats, QRIS stats, withdrawals, balance
      const [vaRes, qrisRes, wdRes] = await Promise.all([
        api.get('/client/va-dashboard', { params: { ...params, limit: 5 } }),
        api.get('/client/dashboard', { params: { ...params, channel: 'QRIS', limit: 5 } }),
        api.get('/client/withdrawals', { params: { clientId: selectedChild !== 'all' ? selectedChild : 'all', limit: 5 } }),
      ])
      
      const vaData = vaRes.data
      const qrisData = qrisRes.data
      const wdData = wdRes.data
      
      // Build summary
      setSummary({
        vaCreated: vaData.stats?.total || 0,
        vaPaid: vaData.stats?.success || 0,
        vaAmount: vaData.stats?.totalPaid || 0,
        qrisCreated: qrisData.totalCount || 0,
        qrisPaid: qrisData.totalSettlement ? Math.round(qrisData.totalSettlement) : 0,
        qrisAmount: qrisData.totalSettlement || 0,
        totalIncome: (vaData.stats?.totalPaid || 0) + (qrisData.totalSettlement || 0),
        totalWithdrawn: wdData.data?.filter((w: any) => w.status === 'COMPLETED').reduce((sum: number, w: any) => sum + (w.amount || 0), 0) || 0,
        pendingWithdrawal: wdData.data?.filter((w: any) => w.status === 'PENDING').reduce((sum: number, w: any) => sum + (w.amount || 0), 0) || 0,
        availableBalance: qrisData.balance || 0,
        pendingSettlement: qrisData.totalPending || 0,
      })
      
      // Set children from any response
      if (vaData.children?.length) {
        setChildren(vaData.children)
      } else if (qrisData.children?.length) {
        setChildren(qrisData.children)
      }
      
      // Recent transactions - merge VA and QRIS
      const vaTxs: RecentTransaction[] = (vaData.transactions || []).slice(0, 3).map((t: any) => ({
        id: t.id,
        type: 'VA' as const,
        status: t.status,
        amount: t.amount,
        netAmount: t.netSettle || t.amount,
        date: t.date,
        reference: t.vaNumber || t.id,
        bankName: t.bankName,
        vaNumber: t.vaNumber,
      }))
      
      const qrisTxs: RecentTransaction[] = (qrisData.transactions || []).slice(0, 3).map((t: any) => ({
        id: t.id,
        type: 'QRIS' as const,
        status: t.status,
        amount: t.amount,
        netAmount: t.netSettle || t.amount,
        date: t.date,
        reference: t.rrn || t.id,
      }))
      
      // Merge and sort by date
      const merged = [...vaTxs, ...qrisTxs]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5)
      
      setRecentTx(merged)
      setRecentWd((wdData.data || []).slice(0, 5))
      
    } catch (err: any) {
      if (err?.response?.status === 401) {
        router.push('/client/login')
      }
      console.error('Failed to fetch overview', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [selectedChild, range, getDateRange, router])
  
  // Initial load
  useEffect(() => {
    fetchOverview()
  }, [fetchOverview])
  
  // Refresh handler
  const handleRefresh = () => {
    setRefreshing(true)
    fetchOverview()
  }
  
  // Copy to clipboard
  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
  }
  
  if (loading) {
    return (
      <div className="dark min-h-screen bg-neutral-950 text-neutral-100 grid place-items-center">
        <div className="text-neutral-400">Loading dashboard...</div>
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
              <BarChart3 className="text-indigo-400" />
              Business Overview
            </h1>
            <p className="text-sm text-neutral-400 mt-1">
              Monitor alur bisnis: VA/QRIS → Transaksi → Saldo → Withdrawal
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 rounded-lg border border-neutral-700 hover:bg-neutral-800 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        
        {/* Filters Row */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {/* Child selector */}
          {children.length > 0 && (
            <select
              value={selectedChild}
              onChange={e => setSelectedChild(e.target.value)}
              className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm"
              data-testid="client-selector"
            >
              <option value="all">Semua Client</option>
              {children.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          
          {/* Date range */}
          <div className="flex rounded-xl border border-neutral-800 overflow-hidden">
            {(['today', 'week', 'month'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-4 py-2 text-sm transition-colors ${
                  range === r 
                    ? 'bg-indigo-600 text-white' 
                    : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                {r === 'today' ? 'Hari Ini' : r === 'week' ? '7 Hari' : '30 Hari'}
              </button>
            ))}
          </div>
        </div>
        
        {/* ==================== FLOW VISUALIZATION ==================== */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp size={20} className="text-emerald-400" />
            Alur Bisnis
          </h2>
          
          {/* Flow Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Step 1: Payment Channels */}
            <div className="lg:col-span-2 rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5">
              <div className="text-xs text-neutral-400 mb-3 uppercase tracking-wide">1. Channel Pembayaran</div>
              
              <div className="grid grid-cols-2 gap-3">
                {/* VA Stats */}
                <div 
                  className="rounded-xl border border-indigo-800/50 bg-indigo-950/30 p-4 cursor-pointer hover:bg-indigo-900/30 transition-colors"
                  onClick={() => router.push('/client/va-dashboard')}
                  data-testid="va-card"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <CreditCard size={18} className="text-indigo-400" />
                    <span className="text-sm font-medium">Virtual Account</span>
                  </div>
                  <div className="text-2xl font-bold">{summary.vaPaid}</div>
                  <div className="text-xs text-neutral-400">dari {summary.vaCreated} dibuat</div>
                  <div className="mt-2 text-sm text-indigo-300 font-medium">
                    {formatIDR(summary.vaAmount)}
                  </div>
                </div>
                
                {/* QRIS Stats */}
                <div 
                  className="rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-4 cursor-pointer hover:bg-emerald-900/30 transition-colors"
                  onClick={() => router.push('/client/dashboard')}
                  data-testid="qris-card"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <QrCode size={18} className="text-emerald-400" />
                    <span className="text-sm font-medium">QRIS</span>
                  </div>
                  <div className="text-2xl font-bold">{summary.qrisCreated}</div>
                  <div className="text-xs text-neutral-400">transaksi</div>
                  <div className="mt-2 text-sm text-emerald-300 font-medium">
                    {formatIDR(summary.qrisAmount)}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Arrow */}
            <div className="hidden lg:flex items-center justify-center">
              <div className="w-12 h-12 rounded-full border-2 border-dashed border-neutral-700 flex items-center justify-center">
                <ChevronRight size={24} className="text-neutral-500" />
              </div>
            </div>
            
            {/* Step 2: Balance */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5">
              <div className="text-xs text-neutral-400 mb-3 uppercase tracking-wide">2. Saldo Client</div>
              
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-neutral-400">Saldo Tersedia</span>
                    <Wallet size={16} className="text-emerald-400" />
                  </div>
                  <div className="text-xl font-bold text-emerald-300">
                    {formatIDR(summary.availableBalance)}
                  </div>
                </div>
                
                <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">Pending Settlement</span>
                    <Clock size={14} className="text-amber-400" />
                  </div>
                  <div className="text-sm font-semibold text-amber-300">
                    {formatIDR(summary.pendingSettlement)}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Step 3: Withdrawal */}
            <div 
              className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 cursor-pointer hover:border-neutral-700 transition-colors"
              onClick={() => router.push('/client/withdraw')}
              data-testid="withdrawal-card"
            >
              <div className="text-xs text-neutral-400 mb-3 uppercase tracking-wide">3. Withdrawal</div>
              
              <div className="space-y-3">
                <div className="rounded-xl border border-blue-800/50 bg-blue-950/30 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-neutral-400">Total Ditarik</span>
                    <ArrowUpFromLine size={16} className="text-blue-400" />
                  </div>
                  <div className="text-xl font-bold text-blue-300">
                    {formatIDR(summary.totalWithdrawn)}
                  </div>
                </div>
                
                {summary.pendingWithdrawal > 0 && (
                  <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-neutral-400">Pending</span>
                      <Timer size={14} className="text-amber-400" />
                    </div>
                    <div className="text-sm font-semibold text-amber-300">
                      {formatIDR(summary.pendingWithdrawal)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
        
        {/* ==================== RECENT ACTIVITY ==================== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Transactions */}
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <History size={18} className="text-neutral-400" />
                Transaksi Terbaru
              </h2>
              <button
                onClick={() => router.push('/client/dashboard')}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                Lihat Semua →
              </button>
            </div>
            
            {recentTx.length === 0 ? (
              <div className="text-center py-8 text-neutral-400 text-sm">
                Belum ada transaksi
              </div>
            ) : (
              <div className="space-y-2">
                {recentTx.map(tx => (
                  <div 
                    key={tx.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        tx.type === 'VA' ? 'bg-indigo-600/30' : 'bg-emerald-600/30'
                      }`}>
                        {tx.type === 'VA' ? <CreditCard size={16} className="text-indigo-400" /> : <QrCode size={16} className="text-emerald-400" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{tx.type}</span>
                          <StatusBadge status={tx.status} />
                        </div>
                        <div className="text-xs text-neutral-400 flex items-center gap-1">
                          <code className="bg-neutral-700/50 px-1 rounded">{tx.reference.slice(0, 12)}...</code>
                          <button onClick={() => copyText(tx.id)} className="hover:text-white">
                            <ClipboardCopy size={10} />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">{formatIDR(tx.amount)}</div>
                      <div className="text-xs text-neutral-400">
                        {new Date(tx.date).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          
          {/* Recent Withdrawals */}
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <ArrowUpFromLine size={18} className="text-neutral-400" />
                Withdrawal Terbaru
              </h2>
              <button
                onClick={() => router.push('/client/withdraw')}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                Lihat Semua →
              </button>
            </div>
            
            {recentWd.length === 0 ? (
              <div className="text-center py-8 text-neutral-400 text-sm">
                Belum ada withdrawal
              </div>
            ) : (
              <div className="space-y-2">
                {recentWd.map(wd => (
                  <div 
                    key={wd.refId}
                    className="flex items-center justify-between p-3 rounded-xl bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-600/30 flex items-center justify-center">
                        <Building2 size={16} className="text-blue-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{wd.bankName}</span>
                          <StatusBadge status={wd.status} />
                        </div>
                        <div className="text-xs text-neutral-400">
                          ••••{wd.accountNumber.slice(-4)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">{formatIDR(wd.amount)}</div>
                      <div className="text-xs text-neutral-400">
                        {new Date(wd.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        
        {/* ==================== QUICK ACTIONS ==================== */}
        <section className="mt-6">
          <h2 className="text-base font-semibold mb-4">Aksi Cepat</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button
              onClick={() => router.push('/client/va-dashboard')}
              className="flex items-center gap-3 p-4 rounded-xl border border-neutral-800 bg-neutral-900/70 hover:bg-neutral-800 transition-colors text-left"
              data-testid="quick-va"
            >
              <CreditCard className="text-indigo-400" />
              <div>
                <div className="text-sm font-medium">VA Dashboard</div>
                <div className="text-xs text-neutral-400">Monitor Virtual Account</div>
              </div>
            </button>
            
            <button
              onClick={() => router.push('/client/dashboard')}
              className="flex items-center gap-3 p-4 rounded-xl border border-neutral-800 bg-neutral-900/70 hover:bg-neutral-800 transition-colors text-left"
              data-testid="quick-qris"
            >
              <QrCode className="text-emerald-400" />
              <div>
                <div className="text-sm font-medium">QRIS Dashboard</div>
                <div className="text-xs text-neutral-400">Monitor transaksi QRIS</div>
              </div>
            </button>
            
            <button
              onClick={() => router.push('/client/withdraw')}
              className="flex items-center gap-3 p-4 rounded-xl border border-neutral-800 bg-neutral-900/70 hover:bg-neutral-800 transition-colors text-left"
              data-testid="quick-withdraw"
            >
              <ArrowUpFromLine className="text-blue-400" />
              <div>
                <div className="text-sm font-medium">Withdrawal</div>
                <div className="text-xs text-neutral-400">Tarik saldo ke rekening</div>
              </div>
            </button>
            
            <button
              onClick={() => router.push('/docs')}
              className="flex items-center gap-3 p-4 rounded-xl border border-neutral-800 bg-neutral-900/70 hover:bg-neutral-800 transition-colors text-left"
              data-testid="quick-docs"
            >
              <Eye className="text-amber-400" />
              <div>
                <div className="text-sm font-medium">API Docs</div>
                <div className="text-xs text-neutral-400">Dokumentasi integrasi</div>
              </div>
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
