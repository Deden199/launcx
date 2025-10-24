'use client'

import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import apiClient from '@/lib/apiClient'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import * as XLSX from 'xlsx'
import { Plus, Upload, Clock, FileText, X, CheckCircle, ArrowUpDown } from 'lucide-react'
import { oyCodeMap } from '../../utils/oyCodeMap'
import { gidiChannelMap } from '../../utils/gidiChannelMap'
import { resolvePiroBankMeta } from '../../utils/piroBankMap'

type ClientOption = { id: string; name: string }
type Provider = 'hilogate' | 'oy' | 'gidi' | 'piro' | 'ing1' | string

interface Withdrawal {
  id: string
  refId: string
  bankName: string
  accountNumber: string
  accountName: string
  wallet: string
  netAmount: number
  withdrawFeePercent: number
  withdrawFeeFlat: number
  amount: number
  status: string
  createdAt: string
  completedAt?: string
  sourceProvider?: string
}

interface SubMerchant {
  id: string
  name: string
  provider: Provider
  balance: number
}

type BulkRow = {
  idx: number
  subMerchantId: string
  bankCode: string
  accountNumber: string
  amount: number
  // optional
  bankName?: string
  accountName?: string
  branchCode?: string
  note?: string
  // runtime
  errors?: string[]
  status?: 'queued' | 'ok' | 'fail'
}

const money = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`
const aliasFrom = (full: string) => {
  const parts = full.trim().split(' ')
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts.at(-1)![0]}.`
}

/** ========= Custom mapping provider =========
 *  - apiBanksParam: query untuk GET /banks?provider=...
 *  - sourceProvider: field yang dikirim ke POST /withdrawals
 * Contoh: provider internal "ing1" → API expects "in-1"
 */
const providerMap = {
  ing1: { apiBanksParam: 'ing1', sourceProvider: 'in-1' },
  hilogate: { apiBanksParam: 'hilogate', sourceProvider: 'hilogate' },
  oy: { apiBanksParam: 'oy', sourceProvider: 'oy' },
  gidi: { apiBanksParam: 'gidi', sourceProvider: 'gidi' },
  piro: { apiBanksParam: 'piro', sourceProvider: 'piro' },
} as const

const getSelectedProvider = (
  subs: SubMerchant[],
  selectedSub: string
): { providerKey: Provider; apiBanksParam: string; sourceProvider: string } => {
  const prov = (subs.find(s => s.id === selectedSub)?.provider || 'hilogate') as Provider
  const map =
    providerMap[(prov as keyof typeof providerMap)] ||
    { apiBanksParam: String(prov), sourceProvider: String(prov) }
  return { providerKey: prov, apiBanksParam: map.apiBanksParam, sourceProvider: map.sourceProvider }
}

// merchant id (ganti sesuai kebutuhanmu / ambil dari context)
const MERCHANT_ID = 'test-merchant'

// toggle: true = simulasi, false = call API beneran
const BULK_DUMMY_MODE = true

export default function WithdrawPage() {
  // ── Dashboard
  const [balance, setBalance] = useState(0)
  const [pending, setPending] = useState(0)
  const [pageError, setPageError] = useState<string>('')

  // ── Parent–Child & Subwallets
  const [children, setChildren] = useState<ClientOption[]>([])
  const [selectedChild, setSelectedChild] = useState<'all' | string>('all')
  const [subs, setSubs] = useState<SubMerchant[]>([])
  const [selectedSub, setSelectedSub] = useState<string>('') // default isi setelah fetch

  // ── Banks (dependent on selected sub/provider)
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([])

  // ── Withdrawals
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)

  // ── Modal/Form
  const [open, setOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [form, setForm] = useState({
    bankCode: '',
    accountNumber: '',
    accountName: '',
    accountNameAlias: '',
    bankName: '',
    branchName: '',
    amount: '',
    otp: '',
  })
  const [isValid, setIsValid] = useState(false)
  const [busy, setBusy] = useState({ validating: false, submitting: false })
  const [error, setError] = useState('')

  // ── Filters & pagination
  const [searchRef, setSearchRef] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('') // debounce 300ms
  const [statusFilter, setStatusFilter] = useState('')
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [total, setTotal] = useState(0)
  const [startDate, endDate] = dateRange

  // ── AbortControllers
  const ctlDashboard = useRef<AbortController | null>(null)
  const ctlSubs = useRef<AbortController | null>(null)
  const ctlList = useRef<AbortController | null>(null)

  // ── Bulk state
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([])
  const [bulkParsing, setBulkParsing] = useState(false)
  const [bulkSubmitting, setBulkSubmitting] = useState(false)
  const [bulkInfo, setBulkInfo] = useState<{ ok: number; fail: number; queued: number }>({ ok: 0, fail: 0, queued: 0 })

  // ── Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchRef), 300)
    return () => clearTimeout(t)
  }, [searchRef])

  // ── Helper provider/bank
  const resolveProviderBank = useCallback(
    (provider: Provider, bankCode: string) => {
      const bankObj = banks.find(b => b.code === bankCode)
      const piroMeta = provider === 'piro'
        ? resolvePiroBankMeta(bankObj?.name, bankCode)
        : null

      const payloadBankCode =
        provider === 'oy'
          ? oyCodeMap[(bankObj?.name || '').toLowerCase()] ?? bankCode
          : provider === 'gidi'
            ? gidiChannelMap[(bankObj?.name || '').toLowerCase()] ?? bankCode
            : provider === 'piro'
              ? piroMeta?.bankCode ?? bankCode
              : bankCode

      return { bankObj, piroMeta, payloadBankCode }
    },
    [banks]
  )

  // ── Dashboard on child change
  const loadDashboard = useCallback(async (clientId: string | 'all') => {
    ctlDashboard.current?.abort()
    ctlDashboard.current = new AbortController()
    try {
      const { data } = await apiClient.get<{ balance: number; totalPending: number; children: ClientOption[] }>(
        '/client/dashboard',
        { params: { clientId }, signal: ctlDashboard.current.signal }
      )
      setBalance(data.balance)
      setPending(data.totalPending ?? 0)
      if (!children.length) setChildren(data.children || [])
    } catch (e: any) {
      if (e?.name !== 'CanceledError') setPageError(e?.message || 'Failed to load data')
    }
  }, [children.length])

  // ── Subwallets on child change
  const loadSubs = useCallback(async (clientId: string | 'all') => {
    ctlSubs.current?.abort()
    ctlSubs.current = new AbortController()
    try {
      const { data } = await apiClient.get<SubMerchant[]>(
        '/client/withdrawals/submerchants',
        { params: { clientId }, signal: ctlSubs.current.signal }
      )
      setSubs(data || [])
      if (!data.find(s => s.id === selectedSub)) {
        setSelectedSub(data[0]?.id || '')
      }
    } catch { }
  }, [selectedSub])

  // ── List withdrawals
  const loadWithdrawals = useCallback(async () => {
    ctlList.current?.abort()
    ctlList.current = new AbortController()
    setLoading(true); setPageError('')

    try {
      const { data } = await apiClient.get<{ data: Withdrawal[]; total: number }>(
        '/client/withdrawals',
        {
          params: {
            clientId: selectedChild,
            page,
            limit: perPage,
            status: statusFilter,
            date_from: startDate?.toISOString(),
            date_to: endDate?.toISOString(),
            ref: debouncedSearch,
          },
          signal: ctlList.current.signal,
        }
      )
      setWithdrawals(data.data)
      setTotal(data.total)
    } catch (e: any) {
      if (e?.name !== 'CanceledError') setPageError(e?.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [selectedChild, page, perPage, statusFilter, startDate, endDate, debouncedSearch])

  // ── Refetch All
  const refetchAll = useCallback(() => {
    loadDashboard(selectedChild)
    loadSubs(selectedChild)
    loadWithdrawals()
  }, [loadDashboard, loadSubs, loadWithdrawals, selectedChild])

  // ── Triggers
  useEffect(() => {
    loadDashboard(selectedChild)
    loadSubs(selectedChild)
    setPage(1)
  }, [selectedChild, loadDashboard, loadSubs])

  useEffect(() => {
    loadWithdrawals()
    return () => { ctlList.current?.abort() }
  }, [loadWithdrawals])

  // ── Banks: fetch setelah sub-wallet dipilih (depend on provider)
  useEffect(() => {
    if (!selectedSub || !subs.length) return
    const { apiBanksParam } = getSelectedProvider(subs, selectedSub)
    const ctl = new AbortController()
    apiClient
      .get<{ banks: { code: string; name: string }[] }>(
        '/banks',
        { params: { provider: apiBanksParam }, signal: ctl.signal }
      )
      .then(res => setBanks(res.data?.banks || []))
      .catch(() => { /* ignore */ })
    return () => ctl.abort()
  }, [selectedSub, subs])

  // ── Handlers (single withdraw)
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))

    if (name === 'amount') {
      const n = +value
      if (!n || n <= 0) setError('Amount harus > 0')
      else if (n > balance) setError('Melebihi saldo')
      else setError('')
    } else if (name === 'bankCode' || name === 'accountNumber') {
      setForm(f => ({ ...f, accountName: '', accountNameAlias: '', bankName: '', branchName: '' }))
      setIsValid(false)
      setError('')
    } else {
      setError('')
    }
  }

  // ── Validate account
  const validateAccount = async () => {
    setBusy(b => ({ ...b, validating: true })); setError('')
    try {
      const { providerKey, sourceProvider } = getSelectedProvider(subs, selectedSub)
      const { bankObj, piroMeta } = resolveProviderBank(providerKey, form.bankCode)

      const body: Record<string, any> = {
        bank_code: providerKey === 'piro' ? (piroMeta?.bankCode ?? form.bankCode) : form.bankCode,
        account_number: form.accountNumber,
        sourceProvider,            // mapping (ing1 → in-1)
        subMerchantId: selectedSub,
      }
      if (providerKey === 'piro') {
        body.bank_name = bankObj?.name ?? form.bankName
        body.branch_code = piroMeta?.branchCode
        body.internal_bank_code = piroMeta?.bankIdentifier
      }

      const res = await apiClient.post('/client/withdrawals/validate-account', body, { validateStatus: () => true })
      if (res.status === 200 && res.data.status === 'valid') {
        const holder = res.data.account_holder as string
        setForm(f => ({
          ...f,
          accountName: holder,
          accountNameAlias: aliasFrom(holder),
          bankName: res.data.bank_name || bankObj?.name || '',
          branchName: res.data.branch_code || res.data.internal_bank_code || piroMeta?.branchCode || '',
        }))
        setIsValid(true)
      } else {
        setIsValid(false)
        setError(res.data.error || 'Rekening bank tidak ditemukan')
      }
    } catch {
      setIsValid(false)
      setError('Gagal koneksi ke server')
    } finally {
      setBusy(b => ({ ...b, validating: false }))
    }
  }

  // ── Submit single withdraw
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid || error) return
    setBusy(b => ({ ...b, submitting: true })); setError('')

    try {
      const { providerKey, sourceProvider } = getSelectedProvider(subs, selectedSub)
      const { bankObj, piroMeta, payloadBankCode } = resolveProviderBank(providerKey, form.bankCode)

      const body: any = {
        subMerchantId: selectedSub,
        sourceProvider,                     // contoh: "in-1"
        merchantId: MERCHANT_ID,            // sesuai contoh
        account_number: form.accountNumber,
        bank_code: payloadBankCode,         // mapping untuk oy/gidi/piro jika perlu
        amount: +form.amount,
        account_name: form.accountName || undefined,
        bank_name: form.bankName || bankObj?.name || undefined,
        otp: form.otp,
      }
      if (providerKey === 'piro') {
        body.branch_code = form.branchName || piroMeta?.branchCode
        body.internal_bank_code = piroMeta?.bankIdentifier
      }

      const res = await apiClient.post('/client/withdrawals', body, { validateStatus: () => true })
      if (res.status === 201) {
        const [dash, list] = await Promise.all([
          apiClient.get('/client/dashboard', { params: { clientId: selectedChild } }),
          apiClient.get<{ data: Withdrawal[]; total: number }>('/client/withdrawals', {
            params: {
              clientId: selectedChild,
              page,
              limit: perPage,
              status: statusFilter,
              date_from: startDate?.toISOString(),
              date_to: endDate?.toISOString(),
              ref: debouncedSearch,
            },
          }),
        ])
        setBalance(dash.data.balance)
        setPending(dash.data.totalPending ?? 0)
        setWithdrawals(list.data.data)
        setTotal(list.data.total)

        setForm(f => ({ ...f, amount: '', accountName: '', accountNameAlias: '', bankName: '', branchName: '', otp: '' }))
        setIsValid(false)
        setOpen(false)
      } else if (res.status === 400) {
        setError(res.data.error || 'Data tidak valid')
      } else if (res.status === 403) {
        setError('Forbidden: Tidak dapat withdraw menggunakan akun parent')
      } else {
        setError('Submit gagal: periksa lagi informasi rekening bank')
      }
    } catch {
      setError('Gagal koneksi ke server')
    } finally {
      setBusy(b => ({ ...b, submitting: false }))
    }
  }

  // ── Export tanpa kolom "Source"
  const exportToExcel = () => {
    const rows = [
      ['Created At', 'Completed At', 'Ref ID', 'Bank', 'Account', 'Account Name', 'Wallet', 'Amount', 'Fee', 'Net Amount', 'Status'],
      ...withdrawals.map(w => {
        const created = new Date(w.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
        const completed = w.completedAt ? new Date(w.completedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-'
        const walletDisplay = w.sourceProvider === 'manual' ? 'Manual Entry' : w.wallet
        const fee = w.amount - (w.netAmount ?? 0)
        const net = w.netAmount ?? 0
        return [created, completed, w.refId, w.bankName, w.accountNumber, w.accountName, walletDisplay, w.amount, fee, net, w.status]
      })
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Withdrawals')
    XLSX.writeFile(wb, 'withdrawals.xlsx')
  }

  // ── Bulk helpers & handlers
  const headerKey = (s: any) => String(s ?? '').toLowerCase().trim()

  const recalcBulkInfo = (rows: BulkRow[]) => {
    const ok = rows.filter(r => (r.errors?.length ?? 0) === 0 && r.status === 'ok').length
    const fail = rows.filter(r => r.status === 'fail').length
    const queued = rows.filter(r => !r.status || r.status === 'queued').length
    setBulkInfo({ ok, fail, queued })
  }

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  const downloadBulkTemplate = () => {
    const headers = [
      'subMerchantId', 'bankCode', 'accountNumber', 'amount',
      'bankName', 'accountName', 'branchCode', 'note'
    ]
    const example1 = [selectedSub || 'sub-123', '014', '1234567890', 2500000, 'BCA', '', '', 'optional note']
    const example2 = [selectedSub || 'sub-123', '009', '9876543210', 1500000, 'BNI', '', '', '']

    const ws = XLSX.utils.aoa_to_sheet([headers, example1, example2])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BulkWithdrawalTemplate')
    XLSX.writeFile(wb, 'bulk_withdraw_template.xlsx')
  }

  const handleBulkFile = async (file: File) => {
    setBulkParsing(true); setPageError('')
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][]

      if (!rows.length) throw new Error('File kosong')

      const headers = (rows[0] || []).map(headerKey)
      const required = ['submerchantid', 'bankcode', 'accountnumber', 'amount']
      const missing = required.filter(k => !headers.includes(k))
      if (missing.length) {
        setBulkRows([]); recalcBulkInfo([])
        setPageError(`Header wajib hilang: ${missing.join(', ')}`)
        return
      }

      const idxOf = (name: string) => headers.indexOf(name)
      const out: BulkRow[] = []

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] || []
        if (r.every(c => c == null || String(c).trim?.() === '')) continue

        const row: BulkRow = {
          idx: i + 1,
          subMerchantId: String(r[idxOf('submerchantid')] ?? '').trim(),
          bankCode: String(r[idxOf('bankcode')] ?? '').trim(),
          accountNumber: String(r[idxOf('accountnumber')] ?? '').trim(),
          amount: Number(r[idxOf('amount')]),
          bankName: String(r[idxOf('bankname')] ?? '').trim() || undefined,
          accountName: String(r[idxOf('accountname')] ?? '').trim() || undefined,
          branchCode: String(r[idxOf('branchcode')] ?? '').trim() || undefined,
          note: String(r[idxOf('note')] ?? '').trim() || undefined,
          status: 'queued',
          errors: []
        }

        if (!row.subMerchantId) row.errors!.push('subMerchantId kosong')
        if (!row.bankCode) row.errors!.push('bankCode kosong')
        if (!row.accountNumber) row.errors!.push('accountNumber kosong')
        if (!row.amount || row.amount <= 0) row.errors!.push('amount harus > 0')

        out.push(row)
      }

      setBulkRows(out)
      recalcBulkInfo(out)
    } catch (e: any) {
      setBulkRows([]); recalcBulkInfo([])
      setPageError(e?.message || 'Gagal memproses file')
    } finally {
      setBulkParsing(false)
    }
  }

  const submitBulk = async () => {
    if (!bulkRows.length) return
    if (bulkRows.some(r => (r.errors?.length ?? 0) > 0)) {
      setPageError('Perbaiki baris yang error sebelum submit.')
      return
    }

    setBulkSubmitting(true); setPageError('')
    try {
      // DUMMY mode: simulasi
      if (BULK_DUMMY_MODE) {
        const cloned = bulkRows.map(r => ({ ...r }))
        for (let i = 0; i < cloned.length; i++) {
          await sleep(120)
          if (cloned[i].amount < 10000) {
            cloned[i].status = 'fail'
            cloned[i].errors = [...(cloned[i].errors || []), 'amount < 10000 (dummy)']
          } else {
            cloned[i].status = 'ok'
          }
          setBulkRows([...cloned]); recalcBulkInfo(cloned)
        }
        refetchAll()
        return
      }

      // REAL mode
      const cloned = bulkRows.map(r => ({ ...r }))
      for (let i = 0; i < cloned.length; i++) {
        const r = cloned[i]
        const subId = r.subMerchantId || selectedSub
        const { providerKey, sourceProvider } = getSelectedProvider(subs, subId)
        const { bankObj, piroMeta, payloadBankCode } = resolveProviderBank(providerKey, r.bankCode)

        const body: any = {
          subMerchantId: subId,
          sourceProvider,
          merchantId: MERCHANT_ID,
          account_number: r.accountNumber,
          bank_code: payloadBankCode,
          amount: +r.amount,
        }
        if (providerKey === 'oy' || providerKey === 'gidi' || providerKey === 'piro') {
          body.bank_name = r.bankName || bankObj?.name
          body.account_name = r.accountName
        }
        if (providerKey === 'piro') {
          body.branch_code = r.branchCode || piroMeta?.branchCode
          body.internal_bank_code = piroMeta?.bankIdentifier
        }

        const res = await apiClient.post('/client/withdrawals', body, { validateStatus: () => true })
        if (res.status === 201) {
          cloned[i].status = 'ok'
        } else {
          cloned[i].status = 'fail'
          cloned[i].errors = [...(cloned[i].errors || []), res.data?.error || `HTTP ${res.status}`]
        }
        setBulkRows([...cloned]); recalcBulkInfo(cloned)
        await sleep(80)
      }

      refetchAll()
    } catch (e: any) {
      setPageError(e?.message || 'Bulk import gagal')
    } finally {
      setBulkSubmitting(false)
    }
  }

  // ── Pagination
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / perPage)), [total, perPage])

  return (
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        {pageError && (
          <div className="mb-4 rounded-xl border border-rose-900/40 bg-rose-950/40 p-3 text-rose-300">
            <p className="mb-2 whitespace-pre-line">{pageError}</p>
            <button
              onClick={refetchAll}
              className="rounded-lg border border-rose-800 bg-rose-900/40 px-3 py-1.5 text-sm hover:bg-rose-900/60"
            >
              🔁 Try Again
            </button>
          </div>
        )}

        {/* Child selector */}
        {children.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <label className="text-sm text-neutral-400">Pilih Child:</label>
            <select
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
              value={selectedChild}
              onChange={e => { setSelectedChild(e.target.value as any); setPage(1) }}
            >
              <option value="all">Semua Child</option>
              {children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {/* Stats */}
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* Sub-wallets */}
          <div className="md:col-span-2 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3">
            <div className="mb-2 text-sm text-neutral-400">Sub-wallets</div>
            <div className="flex flex-wrap gap-3">
              {subs.length ? subs.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSub(s.id)}
                  className={`rounded-xl border px-3 py-2 text-left transition
                    ${s.id === selectedSub
                      ? 'border-sky-500 bg-sky-500/10'
                      : 'border-neutral-800 hover:bg-neutral-800/60'}`}
                >
                  <div className="text-sm font-medium">
                    {s.name || (s.provider ? s.provider[0].toUpperCase() + s.provider.slice(1) : `Sub ${s.id.slice(0, 6)}`)}
                  </div>
                  <div className="text-xs text-neutral-400">{money(s.balance)}</div>
                </button>
              )) : <div className="text-sm text-neutral-500">Tidak ada sub-wallet.</div>}
            </div>
          </div>

          {/* Pending */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 flex items-center gap-3">
            <Clock className="opacity:70" />
            <div>
              <div className="text-sm text-neutral-400">Pending Balance</div>
              <div className="text-lg font-semibold">{money(pending)}</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Withdrawal</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800/60"
            >
              <Upload size={18} /> Import
            </button>

            <button
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800/60"
            >
              <Plus size={18} /> New Withdrawal
            </button>
          </div>
        </div>

        {/* History Card */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-base font-semibold">Withdrawal History</h3>
            <button
              onClick={exportToExcel}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-800/60"
            >
              <FileText size={16} /> Export Excel
            </button>
          </div>

          {/* Filters */}
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              placeholder="Search Ref…"
              value={searchRef}
              onChange={e => { setSearchRef(e.target.value); setPage(1) }}
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
            />
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
            >
              <option value="">All Status</option>
              <option>PENDING</option>
              <option>COMPLETED</option>
              <option>FAILED</option>
            </select>
            <div className="relative md:col-span-2">
              <DatePicker
                selectsRange
                startDate={startDate}
                endDate={endDate}
                onChange={(upd: [Date | null, Date | null]) => {
                  setDateRange(upd)
                  if (upd[0] && upd[1]) setPage(1)
                }}
                isClearable
                placeholderText="Select Date Range…"
                maxDate={new Date()}
                dateFormat="dd-MM-yyyy"
                className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder:text-neutral-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                calendarClassName="!bg-neutral-900 !text-neutral-100 !border !border-neutral-800 !rounded-xl !shadow-2xl !overflow-hidden"
                weekDayClassName={() => '!text-neutral-400 !font-semibold'}
                dayClassName={() =>
                  'rounded-md !text-neutral-100 hover:!bg-neutral-800 focus:!bg-neutral-800'
                }
                withPortal
                portalId="datepicker-portal"
                popperPlacement="bottom-start"
                showPopperArrow={false}
                renderCustomHeader={({ date, decreaseMonth, increaseMonth, prevMonthButtonDisabled, nextMonthButtonDisabled }) => (
                  <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-2.5 py-2">
                    <button
                      type="button"
                      onClick={decreaseMonth}
                      disabled={prevMonthButtonDisabled}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
                      aria-label="Previous month"
                    >
                      ‹
                    </button>
                    <div className="text-sm font-semibold">
                      {date.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
                    </div>
                    <button
                      type="button"
                      onClick={increaseMonth}
                      disabled={nextMonthButtonDisabled}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
                      aria-label="Next month"
                    >
                      ›
                    </button>
                  </div>
                )}
              />

              {(startDate || endDate) && (
                <button
                  type="button"
                  onClick={() => setDateRange([null, null])}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800/60"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-neutral-800">
            {loading ? (
              <div className="p-4 text-sm text-neutral-400">Loading…</div>
            ) : (
              <table className="min-w-[1000px] w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
                    {['Created At', 'Completed At', 'Ref ID', 'Bank', 'Account', 'Account Name', 'Wallet', 'Amount', 'Fee', 'Net Amount', 'Status'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-neutral-300">
                        <span className="inline-flex items-center gap-1">{h}<ArrowUpDown size={14} className="opacity-50" /></span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.length ? withdrawals.map(w => (
                    <tr key={w.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900/60">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(w.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {w.completedAt ? new Date(w.completedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                      </td>
                      <td className="px-3 py-2">{w.refId}</td>
                      <td className="px-3 py-2">{w.bankName}</td>
                      <td className="px-3 py-2">{w.accountNumber}</td>
                      <td className="px-3 py-2">{w.accountName}</td>
                      <td className="px-3 py-2">{w.sourceProvider === 'manual' ? 'Manual Entry' : w.wallet}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{money(w.amount)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{money(w.amount - (w.netAmount ?? 0))}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-semibold">{money(w.netAmount ?? 0)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium
                          ${w.status === 'COMPLETED'
                            ? 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300'
                            : w.status === 'PENDING'
                              ? 'border-amber-900/40 bg-amber-950/40 text-amber-300'
                              : w.status === 'FAILED'
                                ? 'border-rose-900/40 bg-rose-950/40 text-rose-300'
                                : 'border-neutral-800 bg-neutral-900/60 text-neutral-300'}`}>
                          {w.status}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={11} className="px-3 py-10 text-center text-neutral-400">No data</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <div className="inline-flex items-center gap-2 text-sm">
              <span>Rows</span>
              <select
                value={perPage}
                onChange={e => { setPerPage(+e.target.value); setPage(1) }}
                className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 px-2 text-sm outline-none"
              >
                {[5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="inline-flex h-9 items-center rounded-lg border border-neutral-800 px-2.5 disabled:opacity-50 hover:bg-neutral-800/60"
              >‹</button>
              <span className="min-w-[70px] text-center">{page}/{totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="inline-flex h-9 items-center rounded-lg border border-neutral-800 px-2.5 disabled:opacity-50 hover:bg-neutral-800/60"
              >›</button>
            </div>
          </div>
        </section>
      </div>

      {/* ── MODAL: IMPORT (Bulk) */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-2xl bg-neutral-900 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Upload size={18} /> Bulk Withdrawal Import
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={downloadBulkTemplate}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800/60"
                >
                  Download Template
                </button>
                <button
                  type="button"
                  onClick={() => { setImportOpen(false); setBulkRows([]); setBulkInfo({ ok: 0, fail: 0, queued: 0 }) }}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800/60"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Uploader */}
            <div className="mb-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="text-sm text-neutral-300">
                  Unggah file <b>.csv</b> atau <b>.xlsx</b> sesuai template
                </label>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleBulkFile(f)
                  }}
                  className="block w-full max-w-xs rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-sm text-gray-100"
                />
              </div>
              {bulkParsing && <div className="mt-2 text-sm text-neutral-400">Parsing file…</div>}
            </div>

            {/* Summary */}
            <div className="mb-3 text-sm text-neutral-300">
              <span className="mr-3">Queued: <b className="text-neutral-100">{bulkInfo.queued}</b></span>
              <span className="mr-3">OK: <b className="text-emerald-300">{bulkInfo.ok}</b></span>
              <span>Fail: <b className="text-rose-300">{bulkInfo.fail}</b></span>
            </div>

            {/* Preview table */}
            <div className="mb-4 max-h-[50vh] overflow-auto rounded-xl border border-neutral-800">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-900/80 backdrop-blur">
                  <tr className="border-b border-neutral-800">
                    {['#', 'Sub-wallet', 'BankCode', 'AccountNumber', 'Amount', 'Status', 'Errors'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-neutral-300">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bulkRows.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-neutral-500">Belum ada data. Download template lalu unggah file.</td></tr>
                  ) : bulkRows.map(r => (
                    <tr key={r.idx} className="border-b border-neutral-800">
                      <td className="px-3 py-2">{r.idx}</td>
                      <td className="px-3 py-2">{r.subMerchantId}</td>
                      <td className="px-3 py-2">{r.bankCode}</td>
                      <td className="px-3 py-2">{r.accountNumber}</td>
                      <td className="px-3 py-2">{money(r.amount)}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${
                          r.status === 'ok' ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30' :
                          r.status === 'fail' ? 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30' :
                          'bg-neutral-500/15 text-neutral-300 ring-1 ring-neutral-500/30'
                        }`}>
                          {r.status ?? 'queued'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {(r.errors && r.errors.length) ? (
                          <ul className="list-disc pl-4 text-rose-300">
                            {r.errors.map((e, i) => <li key={i}>{e}</li>)}
                          </ul>
                        ) : <span className="text-neutral-500">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-neutral-400">
                Kolom wajib: <code>subMerchantId</code>, <code>bankCode</code>, <code>accountNumber</code>, <code>amount</code>.
              </div>
              <button
                disabled={!bulkRows.length || bulkSubmitting || bulkRows.some(r => (r.errors?.length ?? 0) > 0)}
                onClick={submitBulk}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {bulkSubmitting ? 'Processing…' : BULK_DUMMY_MODE ? 'Simulate Bulk' : 'Submit Bulk'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: NEW WITHDRAWAL (single) */}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-5" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">New Withdrawal</h3>
              <button className="rounded-lg border border-neutral-800 p-1 hover:bg-neutral-800/60" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <form className="grid gap-3" onSubmit={submit}>
              {/* Sub-wallet */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Sub-wallet</label>
                <select
                  name="subMerchantId"
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  value={selectedSub}
                  onChange={e => setSelectedSub(e.target.value)}
                  required
                >
                  {subs.map(s => <option key={s.id} value={s.id}>{s.name || s.provider}</option>)}
                </select>
              </div>

              {/* Bank */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Bank</label>
                <select
                  name="bankCode"
                  value={form.bankCode}
                  onChange={handleChange}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                >
                  <option value="">Pilih bank…</option>
                  {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                </select>
              </div>

              {/* Account Number */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Account Number</label>
                <input
                  name="accountNumber"
                  value={form.accountNumber}
                  onChange={handleChange}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  required
                />
              </div>

              {/* Account Name (readonly) */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Account Name</label>
                <div className="relative">
                  <input
                    readOnly
                    value={form.accountName}
                    placeholder="Isi otomatis setelah validasi"
                    className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  />
                  {isValid && <CheckCircle size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400" />}
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Amount</label>
                <input
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  required
                />
              </div>

              {/* OTP */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">OTP</label>
                <input
                  name="otp"
                  value={form.otp}
                  onChange={handleChange}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  required
                />
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={validateAccount}
                  disabled={busy.validating}
                  className="inline-flex items-center justify-center rounded-lg border border-amber-900/40 bg-amber-950/40 px-3 py-2 text-sm hover:bg-amber-900/30 disabled:opacity-50"
                >
                  {busy.validating ? 'Validating…' : 'Validate'}
                </button>
                <button
                  type="submit"
                  disabled={!isValid || !!error || busy.submitting}
                  className="inline-flex items-center justify-center rounded-lg border border-indigo-900/40 bg-indigo-950/40 px-3 py-2 text-sm hover:bg-indigo-900/30 disabled:opacity-50"
                >
                  {busy.submitting ? 'Submitting…' : 'Submit'}
                </button>
              </div>

              {!!error && <p className="mt-2 rounded-lg border border-rose-900/40 bg-rose-950/40 p-2 text-sm text-rose-300">{error}</p>}
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
