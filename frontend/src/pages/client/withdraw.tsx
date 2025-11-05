'use client';

import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import apiClient from '@/lib/apiClient';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import * as XLSX from 'xlsx';
import {
  Plus,
  Upload,
  Clock,
  FileText,
  X,
  CheckCircle,
  ArrowUpDown,
} from 'lucide-react';
import { oyCodeMap } from '../../utils/oyCodeMap';
import { gidiChannelMap } from '../../utils/gidiChannelMap';
import { resolvePiroBankMeta } from '../../utils/piroBankMap';

// =============================================
// TYPES AND INTERFACES
// =============================================

type ClientOption = { id: string; name: string };
type Provider = 'hilogate' | 'oy' | 'gidi' | 'piro' | 'ing1' | string;

interface Withdrawal {
  id: string;
  refId: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  wallet: string;
  netAmount: number;
  withdrawFeePercent: number;
  withdrawFeeFlat: number;
  amount: number;
  status: string;
  createdAt: string;
  // paidAt?: string;
  completedAt?: string;
  sourceProvider?: string;
  type?: string;
  bulk_id?: string;
}

interface SubMerchant {
  id: string;
  name: string;
  provider: Provider;
  balance: number;
}

interface SubMerchantResponse {
  id: string;
  name: string;
  provider: string;
  balance: number;
}

type BulkRow = {
  idx: number;
  subMerchantId: string;
  type: string;
  bankCode: string;
  accountNumber: string;
  idBulk: string;
  amount: number;
  bankName?: string;
  accountName?: string;
  branchCode?: string;
  note?: string;
  errors?: string[];
  status?: 'queued' | 'ok' | 'fail';
  timestamp?: string;
};

interface JWTPayload {
  sub: string;
  id: string;
  name: string;
  email: string;
  subMerchants?: SubMerchant[];
  iat?: number;
  exp?: number;
}

// =============================================
// CONSTANTS AND UTILITIES
// =============================================

const MERCHANT_ID = 'test-merchant';
const BULK_DUMMY_MODE = false;

// Provider mapping configuration
const providerMap = {
  ing1: { apiBanksParam: 'ing1', sourceProvider: 'ing1' },
  hilogate: { apiBanksParam: 'hilogate', sourceProvider: 'hilogate' },
  oy: { apiBanksParam: 'oy', sourceProvider: 'oy' },
  gidi: { apiBanksParam: 'gidi', sourceProvider: 'gidi' },
  piro: { apiBanksParam: 'piro', sourceProvider: 'piro' },
} as const;

// Utility functions
const decodeJWT = (token: string): JWTPayload | null => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
};

const money = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const aliasFrom = (full: string) => {
  const parts = full.trim().split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts.at(-1)![0]}.`;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Header helpers
const headerKey = (s: any) =>
  String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, '')
    .replace(/_/g, '');

// Template + Required headers
const TEMPLATE_HEADERS = [
  'submerchantid',
  'type',
  'bankcode',
  'accountnumber',
  'idbulk',
  'amount',
  'bankname',
  'accountname',
  'branchcode',
  'note',
] as const;

const REQUIRED_HEADERS = ['submerchantid', 'bankcode', 'accountnumber', 'amount'] as const;

// =============================================
// MAIN COMPONENT
// =============================================

export default function WithdrawPage() {
  // =============================================
  // STATE MANAGEMENT
  // =============================================

  // Dashboard state
  const [balance, setBalance] = useState(0);
  const [pending, setPending] = useState(0);
  const [pageError, setPageError] = useState<string>('');

  // Client and sub-merchant state
  const [children, setChildren] = useState<ClientOption[]>([]);
  const [selectedChild, setSelectedChild] = useState<'all' | string>('all');
  const [subs, setSubs] = useState<SubMerchant[]>([]);
  const [selectedSub, setSelectedSub] = useState<string>('');

  // Banks state
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([]);

  // Withdrawals state
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal and form state
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState({
    type: '',
    bankCode: '',
    accountNumber: '',
    accountName: '',
    idBulk: '',
    accountNameAlias: '',
    bankName: '',
    branchName: '',
    amount: '',
    otp: '',
  });
  const [isValid, setIsValid] = useState(false);
  const [busy, setBusy] = useState({ validating: false, submitting: false });
  const [error, setError] = useState('');

  // Filters and pagination state
  const [searchRef, setSearchRef] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    null,
    null,
  ]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [startDate, endDate] = dateRange;

  // Bulk state
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkInfo, setBulkInfo] = useState<{
    ok: number;
    fail: number;
    queued: number;
  }>({ ok: 0, fail: 0, queued: 0 });
  const [bulkError, setBulkError] = useState<string>(''); // ⬅️ error khusus modal

  // Abort controllers for API calls
  const ctlDashboard = useRef<AbortController | null>(null);
  const ctlList = useRef<AbortController | null>(null);

  // File picker control
  const [filePickerKey, setFilePickerKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Robust amount parser (supports "1.000,50" and "1,000.50")
  const parseAmount = (v: any) => {
    if (typeof v === 'number') return v;
    const s = String(v ?? '').trim();
    if (!s) return NaN;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    const cleaned =
      lastComma > lastDot
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    return Number(cleaned);
  };

  useEffect(() => {
    if (open) {
      setBusy({ validating: false, submitting: false });
      setError('');
      setIsValid(false);
    }
  }, [open]);

  // =============================================
  // UTILITY FUNCTIONS
  // =============================================

  const getSelectedProvider = (
    subs: SubMerchant[],
    selectedSub: string
  ): {
    providerKey: Provider;
    apiBanksParam: string;
    sourceProvider: string;
  } => {
    const prov = (subs.find((s) => s.id === selectedSub)?.provider ||
      'hilogate') as Provider;
    const map = providerMap[prov as keyof typeof providerMap] || {
      apiBanksParam: String(prov),
      sourceProvider: String(prov),
    };
    return {
      providerKey: prov,
      apiBanksParam: map.apiBanksParam,
      sourceProvider: map.sourceProvider,
    };
  };

  const resolveProviderBank = useCallback(
    (provider: Provider, bankCode: string) => {
      const bankObj = banks.find((b) => b.code === bankCode);
      const piroMeta =
        provider === 'piro'
          ? resolvePiroBankMeta(bankObj?.name, bankCode)
          : null;

      const payloadBankCode =
        provider === 'oy'
          ? oyCodeMap[(bankObj?.name || '').toLowerCase()] ?? bankCode
          : provider === 'gidi'
            ? gidiChannelMap[(bankObj?.name || '').toLowerCase()] ?? bankCode
            : provider === 'piro'
              ? piroMeta?.bankCode ?? bankCode
              : bankCode;

      return { bankObj, piroMeta, payloadBankCode };
    },
    [banks]
  );

  const recalcBulkInfo = (rows: BulkRow[]) => {
    const ok = rows.filter(
      (r) => (r.errors?.length ?? 0) === 0 && r.status === 'ok'
    ).length;
    const fail = rows.filter((r) => r.status === 'fail').length;
    const queued = rows.filter(
      (r) => !r.status || r.status === 'queued'
    ).length;
    setBulkInfo({ ok, fail, queued });
  };

  function validateHeaders(rawHeaders: any[]): { ok: boolean; reason?: string } {
    const headers = (rawHeaders || []).map(headerKey);
    if (!headers.length) {
      return { ok: false, reason: 'File kosong atau header tidak terbaca.' };
    }

    const missing = (REQUIRED_HEADERS as readonly string[]).filter(
      (k) => !headers.includes(k)
    );
    if (missing.length) {
      return {
        ok: false,
        reason: `Header wajib hilang: ${missing.join(', ')}`,
      };
    }

    // reject unknown columns
    const allowed = new Set(TEMPLATE_HEADERS as readonly string[]);
    const unknown = headers.filter((h) => !allowed.has(h));
    if (unknown.length) {
      return {
        ok: false,
        reason: `Ditemukan header yang tidak dikenali: ${unknown.join(
          ', '
        )}. Gunakan template.`,
      };
    }
    return { ok: true };
  }

  // =============================================
  // API DATA FETCHING
  // =============================================

  const loadSubMerchantsFromAPI = useCallback(async () => {
    try {
      setLoading(true);
      try {
        const response = await apiClient.get<SubMerchantResponse[]>(
          '/client/withdrawals/submerchants',
          { params: { clientId: 'all' } }
        );

        const subMerchantsFromAPI = response.data;
        if (subMerchantsFromAPI.length > 0) {
          const transformedData: SubMerchant[] = subMerchantsFromAPI.map(
            (item) => ({
              id: item.id,
              name: item.name,
              provider: item.provider as Provider,
              balance: item.balance,
            })
          );

          setSubs(transformedData);
          setSelectedSub(transformedData[0]?.id || '');
          return;
        }
      } catch (apiError) {
        console.warn('❌ API Error, falling back to JWT token:', apiError);
      }

      // Fallback to JWT token only
      const token = localStorage.getItem('clientToken');
      let subMerchantsFromJWT: SubMerchantResponse[] = [];

      if (token) {
        try {
          const decoded = decodeJWT(token) as any;
          if (decoded?.subMerchants && Array.isArray(decoded.subMerchants)) {
            subMerchantsFromJWT = decoded.subMerchants as SubMerchantResponse[];
          } else if (decoded?.wallets && Array.isArray(decoded.wallets)) {
            subMerchantsFromJWT = decoded.wallets as SubMerchantResponse[];
          }
        } catch (jwtError) {
          console.warn('❌ Error decoding JWT:', jwtError);
        }
      }

      if (subMerchantsFromJWT.length > 0) {
        const transformedData = subMerchantsFromJWT.map(
          (item: SubMerchantResponse) => ({
            id: item.id || `sub-${Math.random().toString(36).substring(2, 9)}`,
            name: item.name || `Sub-${item.id?.slice(-6) || 'wallet'}`,
            provider: (item.provider || 'hilogate') as Provider,
            balance: item.balance || 0,
          })
        );

        setSubs(transformedData);
        setSelectedSub(transformedData[0]?.id || '');
      } else {
        setSubs([]);
        setSelectedSub('');
      }
    } catch (error) {
      console.error('❌ Error in sub-merchants loading:', error);
      setSubs([]);
      setSelectedSub('');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDashboard = useCallback(
    async (clientId: string | 'all') => {
      ctlDashboard.current?.abort();
      ctlDashboard.current = new AbortController();
      try {
        const { data } = await apiClient.get<{
          balance: number;
          totalPending: number;
          children: ClientOption[];
        }>('/client/dashboard', {
          params: { clientId },
          signal: ctlDashboard.current.signal,
        });
        setBalance(data.balance);
        setPending(data.totalPending ?? 0);
        if (!children.length) setChildren(data.children || []);
      } catch (e: any) {
        if (e?.name !== 'CanceledError')
          setPageError(e?.message || 'Failed to load data');
      }
    },
    [children.length]
  );

  const loadWithdrawals = useCallback(async () => {
    ctlList.current?.abort();
    ctlList.current = new AbortController();
    setLoading(true);
    setPageError('');

    try {
      const { data } = await apiClient.get<{
        data: Withdrawal[];
        total: number;
      }>('/client/withdrawals', {
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
      });

      setWithdrawals(data.data);
      setTotal(data.total);
    } catch (e: any) {
      if (e?.name !== 'CanceledError') {
        const errorMsg =
          e?.response?.data?.error || e?.message || 'Failed to load data';
        setPageError(errorMsg);
        console.error('❌ Load withdrawals error:', e);
      }
    } finally {
      setLoading(false);
    }
  }, [
    selectedChild,
    page,
    perPage,
    statusFilter,
    startDate,
    endDate,
    debouncedSearch,
  ]);

  const refetchAll = useCallback(() => {
    loadDashboard(selectedChild);
    loadWithdrawals();
  }, [loadDashboard, loadWithdrawals, selectedChild]);

  // =============================================
  // EFFECTS AND DATA LOADING
  // =============================================

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchRef), 300);
    return () => clearTimeout(t);
  }, [searchRef]);

  useEffect(() => {
    loadSubMerchantsFromAPI();
  }, [loadSubMerchantsFromAPI]);

  useEffect(() => {
    loadDashboard(selectedChild);
    setPage(1);
  }, [selectedChild, loadDashboard]);

  useEffect(() => {
    loadWithdrawals();
    return () => {
      ctlList.current?.abort();
    };
  }, [loadWithdrawals]);

  useEffect(() => {
    if (!selectedSub || !subs.length) return;
    const { apiBanksParam } = getSelectedProvider(subs, selectedSub);
    const ctl = new AbortController();
    apiClient
      .get<{ banks: { code: string; name: string }[] }>('/banks', {
        params: { provider: apiBanksParam },
        signal: ctl.signal,
      })
      .then((res) => setBanks(res.data?.banks || []))
      .catch(() => {
        /* ignore */
      });
    return () => ctl.abort();
  }, [selectedSub, subs]);

  // =============================================
  // SINGLE WITHDRAWAL HANDLERS
  // =============================================

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));

    if (name === 'amount') {
      const n = +value;
      const subBal = subs.find((s) => s.id === selectedSub)?.balance ?? 0;
      if (!n || n <= 0) setError('Amount harus > 0');
      else if (n > subBal) setError('Melebihi saldo sub-wallet terpilih');
      else setError('');
    } else if (name === 'bankCode' || name === 'accountNumber') {
      setForm((f) => ({
        ...f,
        accountName: '',
        accountNameAlias: '',
        bankName: '',
        branchName: '',
      }));
      setIsValid(false);
      setError('');
    } else {
      setError('');
    }
  };

  const validateAccount = async () => {
    if (!selectedSub) {
      setError('Pilih sub-wallet terlebih dahulu');
      return;
    }
    if (!form.bankCode) {
      setError('Pilih bank');
      return;
    }
    if (!form.accountNumber?.trim()) {
      setError('Nomor rekening wajib diisi');
      return;
    }

    setBusy((b) => ({ ...b, validating: true }));
    setError('');
    setIsValid(false);

    try {
      let providerKey: string, sourceProvider: string;
      let bankObj: any, piroMeta: any;

      try {
        const sel = getSelectedProvider(subs, selectedSub);
        providerKey = sel.providerKey;
        sourceProvider = sel.sourceProvider;
      } catch (e) {
        console.error('getSelectedProvider error:', e);
        setError('Sub-wallet tidak valid');
        return;
      }

      try {
        const resolved = resolveProviderBank(providerKey, form.bankCode);
        bankObj = resolved.bankObj;
        piroMeta = resolved.piroMeta;
      } catch (e) {
        console.error('resolveProviderBank error:', e);
        setError('Kode bank tidak dikenali untuk provider ini');
        return;
      }

      const body: Record<string, any> = {
        bank_code:
          providerKey === 'piro'
            ? piroMeta?.bankCode ?? form.bankCode
            : form.bankCode,
        account_number: form.accountNumber,
        sourceProvider,
        subMerchantId: selectedSub,
      };
      if (providerKey === 'piro') {
        body.bank_name = bankObj?.name ?? form.bankName;
        body.branch_code = piroMeta?.branchCode;
        body.internal_bank_code = piroMeta?.bankIdentifier;
      }

      const res = await apiClient.post(
        '/client/withdrawals/validate-account',
        body,
        {
          validateStatus: () => true,
          timeout: 20000,
        }
      );

      if (res.status === 200 && res.data?.status === 'valid') {
        const holder = String(res.data.account_holder || '').trim();
        setForm((f) => ({
          ...f,
          accountName: holder,
          accountNameAlias: aliasFrom(holder),
          bankName: res.data.bank_name || bankObj?.name || '',
          branchName:
            res.data.branch_code ||
            res.data.internal_bank_code ||
            piroMeta?.branchCode ||
            '',
        }));
        setIsValid(true);
        setError('');
      } else {
        const apiErr =
          res.data?.error || `Validasi gagal (status ${res.status})`;
        setIsValid(false);
        setError(apiErr);
      }
    } catch (e: any) {
      console.error('validateAccount fatal error:', e);
      setIsValid(false);
      setError('Gagal koneksi ke server');
    } finally {
      setBusy((b) => ({ ...b, validating: false }));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || error) return;
    setBusy((b) => ({ ...b, submitting: true }));
    setError('');

    try {
      const { providerKey, sourceProvider } = getSelectedProvider(
        subs,
        selectedSub
      );
      const { bankObj, piroMeta, payloadBankCode } = resolveProviderBank(
        providerKey,
        form.bankCode
      );

      const body: any = {
        subMerchantId: selectedSub,
        sourceProvider,
        merchantId: MERCHANT_ID,
        account_number: form.accountNumber,
        bank_code: payloadBankCode,
        amount: +form.amount,
        account_name: form.accountName || undefined,
        bank_name: form.bankName || bankObj?.name || undefined,
        otp: form.otp,
      };

      if (providerKey === 'piro') {
        body.branch_code = form.branchName || piroMeta?.branchCode;
        body.internal_bank_code = piroMeta?.bankIdentifier;
      }

      const res = await apiClient.post('/client/withdrawals', body, {
        validateStatus: () => true,
      });

      if (res.status === 201) {
        const [dash, list] = await Promise.all([
          apiClient.get('/client/dashboard', {
            params: { clientId: selectedChild },
          }),
          apiClient.get<{ data: Withdrawal[]; total: number }>(
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
            }
          ),
        ]);

        setBalance(dash.data.balance);
        setPending(dash.data.totalPending ?? 0);
        setWithdrawals(list.data.data);
        setTotal(list.data.total);

        setForm((f) => ({
          ...f,
          amount: '',
          accountName: '',
          accountNameAlias: '',
          bankName: '',
          branchName: '',
          otp: '',
        }));
        setIsValid(false);
        setOpen(false);
      } else if (res.status === 400) {
        setError(res.data.error || 'Data tidak valid');
      } else if (res.status === 403) {
        setError('Forbidden: Tidak dapat withdraw menggunakan akun parent');
      } else {
        setError('Submit gagal: periksa lagi informasi rekening bank');
      }
    } catch {
      setError('Gagal koneksi ke server');
    } finally {
      setBusy((b) => ({ ...b, submitting: false }));
    }
  };

  // =============================================
  // BULK WITHDRAWAL HANDLERS
  // =============================================

  const downloadBulkTemplate = () => {
    if (subs.length === 0) {
      alert('Tidak ada sub-merchant yang tersedia');
      return;
    }

    const headers = [
      'subMerchantId',
      'type',
      'bankCode',
      'accountNumber',
      'idBulk',
      'amount',
      'bankName',
      'accountName',
      'branchCode',
      'note',
    ];

    const exampleBulkId = `bulk-${Date.now()}-1`;
    const exampleData = [
      subs[0]?.id || '',
      'bulk',
      '014',
      '1234567890',
      exampleBulkId,
      50000,
      'BCA',
      'JOHN DOE',
      '',
      'Test withdrawal bulk',
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, exampleData]);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'bulk_withdraw_template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkFile = async (file: File) => {
    setBulkParsing(true);
    setBulkError(''); // ⬅️ gunakan error khusus modal
    setBulkRows([]);
    recalcBulkInfo([]);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: true,
      }) as any[][];

      if (!rows.length) throw new Error('File kosong');

      const validation = validateHeaders(rows[0] || []);
      if (!validation.ok) {
        setBulkRows([]);
        recalcBulkInfo([]);
        setBulkError(validation.reason || 'File tidak sesuai template.');
        fileInputRef.current && (fileInputRef.current.value = '');
        return;
      }

      const headers = (rows[0] || []).map(headerKey);
      const required = ['submerchantid', 'bankcode', 'accountnumber', 'amount'];
      const missing = required.filter((k) => !headers.includes(k));
      if (missing.length) {
        setBulkRows([]);
        recalcBulkInfo([]);
        setBulkError(`Header wajib hilang: ${missing.join(', ')}`);
        return;
      }

      const idxOf = (name: string) => headers.indexOf(name);
      const out: BulkRow[] = [];
      const bulkTimestamp = Date.now();

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] || [];
        if (r.every((c) => c == null || String(c).trim?.() === '')) continue;

        const idBulkFromFile = String(r[idxOf('idbulk')] ?? '').trim();
        const finalIdBulk = idBulkFromFile || `bulk-${bulkTimestamp}-${i}`;

        const row: BulkRow = {
          idx: i,
          subMerchantId: String(r[idxOf('submerchantid')] ?? '').trim(),
          type: 'bulk',
          bankCode: String(r[idxOf('bankcode')] ?? '').trim(),
          accountNumber: String(r[idxOf('accountnumber')] ?? '').trim(),
          amount: parseAmount(r[idxOf('amount')]),
          bankName: String(r[idxOf('bankname')] ?? '').trim() || undefined,
          accountName:
            String(r[idxOf('accountname')] ?? '').trim() || undefined,
          idBulk: finalIdBulk,
          branchCode: String(r[idxOf('branchcode')] ?? '').trim() || undefined,
          note: String(r[idxOf('note')] ?? '').trim() || undefined,
          status: 'queued',
          errors: [],
          timestamp: bulkTimestamp.toString(),
        };

        // Validation
        if (!row.subMerchantId) row.errors!.push('subMerchantId kosong');
        if (!row.bankCode) row.errors!.push('bankCode kosong');
        if (!row.accountNumber) row.errors!.push('accountNumber kosong');

        if (!Number.isFinite(row.amount))
          row.errors!.push('amount kosong atau tidak valid');
        else if (row.amount <= 0)
          row.errors!.push('amount harus > 0');

        if (Number.isFinite(row.amount) && row.amount > 1000000)
          row.errors!.push('amount terlalu besar. Maksimal: 1,000,000');

        const subWallet = subs.find((s) => s.id === row.subMerchantId);
        if (!subWallet) {
          row.errors!.push(
            `Sub-merchant "${row.subMerchantId}" tidak ditemukan`
          );
        } else if ((row.errors?.length ?? 0) === 0 && row.amount > subWallet.balance) {
          row.errors!.push(
            `Saldo tidak mencukupi. Butuh: ${money(row.amount)}, Saldo: ${money(
              subWallet.balance
            )}`
          );
        }

        out.push(row);
      }

      setBulkRows(out);
      recalcBulkInfo(out);
    } catch (e: any) {
      setBulkRows([]);
      recalcBulkInfo([]);
      setBulkError(e?.message || 'Gagal memproses file');
    } finally {
      setBulkParsing(false);
      setFilePickerKey((k) => k + 1); // force remount input agar upload file yang sama juga re-parse
    }
  };

  const submitBulk = async () => {
    if (!bulkRows.length) return;
    if (bulkRows.some((r) => (r.errors?.length ?? 0) > 0)) {
      setBulkError('Perbaiki baris yang error sebelum submit.');
      return;
    }

    setBulkSubmitting(true);
    setBulkError('');

    try {
      const cloned = bulkRows.map((r) => ({ ...r }));
      let hasError = false;
      let successCount = 0;

      for (let i = 0; i < cloned.length; i++) {
        const r = cloned[i];
        const subId = r.subMerchantId || selectedSub;
        const subWallet = subs.find((s) => s.id === subId);

        if (!subWallet) {
          cloned[i].status = 'fail';
          cloned[i].errors = [
            ...(cloned[i].errors || []),
            `Sub-wallet "${subId}" tidak ditemukan`,
          ];
          hasError = true;
          continue;
        }

        if (r.amount > subWallet.balance) {
          cloned[i].status = 'fail';
          cloned[i].errors = [
            ...(cloned[i].errors || []),
            `Saldo tidak mencukupi. Butuh: ${money(r.amount)}, Saldo: ${money(
              subWallet.balance
            )}`,
          ];
          hasError = true;
          continue;
        }

        const { providerKey, sourceProvider } = getSelectedProvider(
          subs,
          subId
        );
        const { bankObj, piroMeta, payloadBankCode } = resolveProviderBank(
          providerKey,
          r.bankCode
        );
        const finalBulkId = r.idBulk || `bulk-${Date.now()}-${i + 1}`;

        const body: any = {
          subMerchantId: subId,
          sourceProvider,
          account_number: r.accountNumber,
          bank_code: payloadBankCode,
          amount: +r.amount,
          type: 'bulk',
          bulk_id: finalBulkId,
        };

        if (r.accountName) body.account_name = r.accountName;
        if (r.bankName) body.bank_name = r.bankName;
        if (r.branchCode) body.branch_code = r.branchCode;
        if (r.note) body.note = r.note;

        if (['oy', 'gidi', 'piro'].includes(providerKey)) {
          body.bank_name = r.bankName || bankObj?.name;
          if (r.accountName) body.account_name = r.accountName;
        }
        if (providerKey === 'piro') {
          body.branch_code = r.branchCode || piroMeta?.branchCode;
          body.internal_bank_code = piroMeta?.bankIdentifier;
        }

        try {
          // NOTE: sesuaikan endpoint ini dengan backend kamu jika perlu
          const res = await apiClient.post('/withdrawals', body, {
            validateStatus: () => true,
          });

          if (res.status === 201) {
            cloned[i].status = 'ok';
            successCount++;
            setSubs((prev) =>
              prev.map((s) =>
                s.id === subId ? { ...s, balance: s.balance - r.amount } : s
              )
            );
          } else {
            cloned[i].status = 'fail';
            const errorMsg =
              res.data?.error || res.data?.message || `HTTP ${res.status}`;
            cloned[i].errors = [...(cloned[i].errors || []), errorMsg];
            hasError = true;
          }
        } catch (apiError: any) {
          cloned[i].status = 'fail';
          cloned[i].errors = [
            ...(cloned[i].errors || []),
            apiError.message || 'Network error',
          ];
          hasError = true;
        }

        setBulkRows([...cloned]);
        recalcBulkInfo(cloned);
        await sleep(500);
      }

      if (successCount > 0) {
        await Promise.all([loadWithdrawals(), loadDashboard(selectedChild)]);
        setBulkError(
          `✅ ${successCount} transaksi berhasil diproses${hasError ? ', beberapa gagal' : ''
          }`
        );
      }

      if (!hasError) {
        setTimeout(() => {
          setImportOpen(false);
          setBulkRows([]);
          setBulkInfo({ ok: 0, fail: 0, queued: 0 });
          setBulkError('');
        }, 2000);
      } else {
        setBulkError(
          `${successCount} berhasil, ${cloned.length - successCount
          } gagal. Periksa kolom Errors.`
        );
      }
    } catch (e: any) {
      console.error('❌ Bulk import error:', e);
      setBulkError(e?.message || 'Bulk import gagal');
    } finally {
      setBulkSubmitting(false);
    }
  };

  // =============================================
  // EXPORT AND PAGINATION
  // =============================================

  const exportToExcel = () => {
    const rows = [
      [
        'Created At',
        'Paid At',
        'Ref ID',
        'Type',
        'Bank',
        'Account',
        'Account Name',
        'Bulk ID',
        'Wallet',
        'Amount',
        'Fee',
        'Net Amount',
        'Status',
      ],
      ...withdrawals.map((w) => {
        const created = new Date(w.createdAt).toLocaleString('id-ID', {
          dateStyle: 'short',
          timeStyle: 'short',
        });
        const completed = w.completedAt
          ? new Date(w.completedAt).toLocaleString('id-ID', {
            dateStyle: 'short',
            timeStyle: 'short',
          })
          : '-';
    
        const walletDisplay =
          w.sourceProvider === 'manual' ? 'Manual Entry' : w.wallet;
        const fee = w.amount - (w.netAmount ?? 0);
        const net = w.netAmount ?? 0;

        return [
          created,                 // Created At
          completed,               // Completed At
          w.refId,                 // Ref ID
          w.type || 'Bulk',        // Type  <<< dipindah ke sini
          w.bankName,              // Bank
          w.accountNumber,         // Account
          w.accountName,           // Account Name
          w.bulk_id || '-',        // Bulk ID
          walletDisplay,           // Wallet
          w.amount,                // Amount (angka mentah biar bisa dihitung di Excel)
          fee,                     // Fee
          net,                     // Net Amount
          w.status,                // Status
        ];
      }),
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Withdrawals');
    XLSX.writeFile(wb, 'withdrawals.xlsx');
  };


  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / perPage)),
    [total, perPage]
  );

  // =============================================
  // RENDER
  // =============================================

  return (
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        {/* Error Display (global page) */}
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

        {/* Child Selector */}
        {children.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <label className="text-sm text-neutral-400">Pilih Child:</label>
            <select
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
              value={selectedChild}
              onChange={(e) => {
                setSelectedChild(e.target.value as any);
                setPage(1);
              }}
            >
              <option value="all">Semua Child</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Stats Dashboard */}
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* Sub-wallets */}
          <div className="md:col-span-2 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3">
            <div className="mb-2 text-sm text-neutral-400">Sub-wallets</div>
            {loading ? (
              <div className="text-sm text-neutral-500">
                Loading sub-wallets...
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {subs.length ? (
                  subs.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSub(s.id)}
                      className={`rounded-xl border px-3 py-2 text-left transition ${s.id === selectedSub
                          ? 'border-sky-500 bg-sky-500/10'
                          : 'border-neutral-800 hover:bg-neutral-800/60'
                        }`}
                    >
                      <div className="text-sm font-medium">
                        {s.name || `Sub ${s.id.slice(0, 6)}`}
                      </div>
                      <div className="text-xs text-neutral-400">
                        {money(s.balance)}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="text-sm text-neutral-500">
                    Tidak ada sub-wallet yang tersedia.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pending Balance */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 flex items-center gap-3">
            <Clock className="opacity-70" />
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
              onClick={() => {
                setImportOpen(true);
                setBulkError(''); // ⬅️ reset error modal saat buka
              }}
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
              onChange={(e) => {
                setSearchRef(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
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
                  setDateRange(upd);
                  if (upd[0] && upd[1]) setPage(1);
                }}
                isClearable
                placeholderText="Select Date Range…"
                maxDate={new Date()}
                dateFormat="dd-MM-yyyy"
                className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder:text-neutral-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                calendarClassName="!bg-neutral-900 !text-neutral-100 !border !border-neutral-800 !rounded-xl !shadow-2xl !overflow-hidden"
                weekDayClassName={() =>
                  '!text-neutral-400 !font-semibold'
                }
                dayClassName={() =>
                  'rounded-md !text-neutral-100 hover:!bg-neutral-800 focus:!bg-neutral-800'
                }
                withPortal
                portalId="datepicker-portal"
                popperPlacement="bottom-start"
                showPopperArrow={false}
                renderCustomHeader={({
                  date,
                  decreaseMonth,
                  increaseMonth,
                  prevMonthButtonDisabled,
                  nextMonthButtonDisabled,
                }) => (
                  <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-2.5 py-2">
                    <button
                      type="button"
                      onClick={decreaseMonth}
                      disabled={prevMonthButtonDisabled}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
                    >
                      ‹
                    </button>
                    <div className="text-sm font-semibold">
                      {date.toLocaleString('en-US', {
                        month: 'long',
                        year: 'numeric',
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={increaseMonth}
                      disabled={nextMonthButtonDisabled}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
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
                    {[
                      'Created At',
                      'Paid At',
                      'Ref ID',
                      'Type',
                      'Bank',
                      'Account',
                      'Account Name',
                      'Bulk ID',
                      'Wallet',
                      'Amount',
                      'Fee',
                      'Net Amount',
                      'Status',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-medium text-neutral-300"
                      >
                        <span className="inline-flex items-center gap-1">
                          {h}
                          <ArrowUpDown size={14} className="opacity-50" />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.length ? (
                    withdrawals.map((w, i) => (
                      <tr
                        key={i}
                        className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900/60"
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(w.createdAt).toLocaleString('id-ID', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {w.completedAt
                            ? new Date(w.completedAt).toLocaleString('id-ID', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                            : '-'}
                        </td>
                     
                        <td className="px-3 py-2">{w.refId}</td>
                        <td className="px-3 py-2">{w.type || 'Bulk'}</td>
                        <td className="px-3 py-2">{w.bankName}</td>
                        <td className="px-3 py-2">{w.accountNumber}</td>
                        <td className="px-3 py-2">{w.accountName}</td>
                        <td className="px-3 py-2">{w.bulk_id || '-'}</td>
                        <td className="px-3 py-2">
                          {w.sourceProvider === 'manual'
                            ? 'Manual Entry'
                            : w.wallet}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {money(w.amount)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {money(w.amount - (w.netAmount ?? 0))}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap font-semibold">
                          {money(w.netAmount ?? 0)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${w.status === 'COMPLETED'
                                ? 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300'
                                : w.status === 'PENDING'
                                  ? 'border-amber-900/40 bg-amber-950/40 text-amber-300'
                                  : w.status === 'FAILED'
                                    ? 'border-rose-900/40 bg-rose-950/40 text-rose-300'
                                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-300'
                              }`}
                          >
                            {w.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={13}
                        className="px-3 py-10 text-center text-neutral-400"
                      >
                        No data
                      </td>
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
                onChange={(e) => {
                  setPerPage(+e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 px-2 text-sm outline-none"
              >
                {[5, 10, 20].map((n) => (
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
                className="inline-flex h-9 items-center rounded-lg border border-neutral-800 px-2.5 disabled:opacity-50 hover:bg-neutral-800/60"
              >
                ‹
              </button>
              <span className="min-w-[70px] text-center">
                {page}/{totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="inline-flex h-9 items-center rounded-lg border border-neutral-800 px-2.5 disabled:opacity-50 hover:bg-neutral-800/60"
              >
                ›
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Bulk Import Modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-2xl bg-neutral-900 p-6 shadow-xl" role="dialog" aria-modal="true">
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
                  onClick={() => {
                    setImportOpen(false);
                    setBulkRows([]);
                    setBulkInfo({ ok: 0, fail: 0, queued: 0 });
                    setBulkError('');
                  }}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800/60"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Banner error/notice khusus modal */}
            {bulkError && (
              <div
                role="status"
                aria-live="polite"
                className={`mb-4 rounded-xl border p-3 text-sm ${bulkError.startsWith('✅')
                    ? 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300'
                    : 'border-rose-900/40 bg-rose-950/40 text-rose-300'
                  }`}
              >
                {bulkError}
              </div>
            )}

            {/* Uploader */}
            <div className="mb-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="text-sm text-neutral-300">
                  Unggah file <b>.csv</b> sesuai template
                </label>
                <input
                  key={filePickerKey}
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onClick={(e) => {
                    (e.currentTarget as HTMLInputElement).value = '';
                  }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleBulkFile(f);
                  }}
                  className="block w-full max-w-xs rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-sm text-gray-100"
                />
              </div>
              {bulkParsing && (
                <div className="mt-2 text-sm text-neutral-400">
                  Parsing file…
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="mb-3 text-sm text-neutral-300">
              <span className="mr-3">
                Queued: <b className="text-neutral-100">{bulkInfo.queued}</b>
              </span>
              <span className="mr-3">
                OK: <b className="text-emerald-300">{bulkInfo.ok}</b>
              </span>
              <span>
                Fail: <b className="text-rose-300">{bulkInfo.fail}</b>
              </span>
            </div>

            {/* Preview Table */}
            <div className="mb-4 max-h-[50vh] overflow-auto rounded-xl border border-neutral-800">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-900/80 backdrop-blur">
                  <tr className="border-b border-neutral-800">
                    {[
                      '#',
                      'Sub-wallet',
                      'Type',
                      'BankCode',
                      'AccountNumber',
                      'Bulk ID',
                      'Amount',
                      'Status',
                      'Errors',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-medium text-neutral-300"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bulkParsing ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-3 py-8 text-center text-neutral-400 animate-pulse"
                      >
                        Sedang memuat data...
                      </td>
                    </tr>
                  ) : bulkRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-3 py-8 text-center text-neutral-500"
                      >
                        Belum ada data. Download template lalu unggah file.
                      </td>
                    </tr>
                  ) : (
                    bulkRows.map((r) => (
                      <tr key={r.idx} className="border-b border-neutral-800">
                        <td className="px-3 py-2">{r.idx}</td>
                        <td className="px-3 py-2">
                          {subs.find((s) => s.id === r.subMerchantId)?.name ||
                            r.subMerchantId}
                        </td>
                        <td className="px-3 py-2">Bulk</td>
                        <td className="px-3 py-2">{r.bankCode}</td>
                        <td className="px-3 py-2">{r.accountNumber}</td>
                        <td className="px-3 py-2">{r.idBulk}</td>
                        <td className="px-3 py-2">{money(r.amount)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${r.status === 'ok'
                                ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                                : r.status === 'fail'
                                  ? 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30'
                                  : 'bg-neutral-500/15 text-neutral-300 ring-1 ring-neutral-500/30'
                              }`}
                          >
                            {r.status ?? 'queued'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {r.errors && r.errors.length ? (
                            <ul className="list-disc pl-4 text-rose-300">
                              {r.errors.map((e, i) => (
                                <li key={i}>{e}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-neutral-500">-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-neutral-400">
                Kolom wajib: <code>subMerchantId</code>, <code>bankCode</code>,{' '}
                <code>accountNumber</code>, <code>amount</code>.
              </div>
              <button
                disabled={
                  !bulkRows.length ||
                  bulkSubmitting ||
                  bulkRows.some((r) => (r.errors?.length ?? 0) > 0)
                }
                onClick={submitBulk}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {bulkSubmitting
                  ? 'Processing…'
                  : BULK_DUMMY_MODE
                    ? 'Simulate Bulk'
                    : 'Submit Bulk'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Withdrawal Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">New Withdrawal</h3>
              <button
                className="rounded-lg border border-neutral-800 p-1 hover:bg-neutral-800/60"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form className="grid gap-3" onSubmit={submit}>
              <div>
                <label className="mb-1 block text-sm text-neutral-300">
                  Sub-wallet
                </label>
                <select
                  name="subMerchantId"
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  value={selectedSub}
                  onChange={(e) => setSelectedSub(e.target.value)}
                  required
                >
                  {subs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || s.provider} - {money(s.balance)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm text-neutral-300">
                  Bank
                </label>
                <select
                  name="bankCode"
                  value={form.bankCode}
                  onChange={handleChange}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                >
                  <option value="">Pilih bank…</option>
                  {banks.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name || b.code}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm text-neutral-300">
                  Account Number
                </label>
                <input
                  name="accountNumber"
                  value={form.accountNumber}
                  onChange={handleChange}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-neutral-300">
                  Account Name
                </label>
                <div className="relative">
                  <input
                    readOnly
                    value={form.accountName}
                    placeholder="Isi otomatis setelah validasi"
                    className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  />
                  {isValid && (
                    <CheckCircle
                      size={18}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400"
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm text-neutral-300">
                  Amount
                </label>
                <input
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-neutral-300">
                  OTP
                </label>
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
                  disabled={
                    busy.validating ||
                    !form.bankCode ||
                    !form.accountNumber ||
                    !selectedSub
                  }
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

              {!!error && (
                <p className="mt-2 rounded-lg border border-rose-900/40 bg-rose-950/40 p-2 text-sm text-rose-300">
                  {error}
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
