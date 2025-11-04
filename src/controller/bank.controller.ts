// File: src/controllers/bank.controller.ts

import { Request, Response } from 'express';
import { prisma } from '../core/prisma';
import { HilogateClient, HilogateConfig } from '../service/hilogateClient';
import { Ing1Client, Ing1Config } from '../service/ing1Client';
import { isJakartaWeekend } from '../util/time'
import { cacheGet, cacheSet } from '../core/redis';

// List of INA/ING supported banks
const INA_ING_SUPPORTED_BANKS = [
  'bca', 'mandiri', 'bni', 'bri', 'cimb', 'maybank',
  'permata', 'danamon', 'oke', 'mega', 'btn', 'bsi',
  'panin', 'ocbc', 'uob', 'dbs', 'hsbc'
];

export async function getBanks(req: Request, res: Response) {
  try {
    // Get optional provider filter param (ina | ing | hilogate)
    const providerFilter = req.query.provider as string | undefined;

    let banks: { name: string; code: string }[] = [];
    let errorMessage = '';

    // If provider is explicitly set to 'ina' or 'ing', use ING1 client
    if (providerFilter && ['ina', 'ing1'].includes(providerFilter.toLowerCase())) {
      return await getBanksFromIna(req, res, providerFilter);
    }

    // Default: Use Hilogate
    // Check cache first (banks list rarely changes)
    const cacheKey = 'banks:list:hilogate';
    const cached = await cacheGet<any>(cacheKey);
    if (cached) {
      return res.json({ banks: cached, cached: true });
    }

    // 1) Cari internal merchant Hilogate
    const merchant = await prisma.merchant.findFirst({
      where: { name: 'hilogate' }
    });
    if (!merchant) {
      return res.status(500).json({ error: 'Internal Hilogate merchant not found' });
    }

    const isWeekend = isJakartaWeekend(new Date());
    const allSubs = await prisma.sub_merchant.findMany({
      where: {
        merchantId: merchant.id,
        provider: 'hilogate',
      }
    });
    const subs = allSubs.filter(s => s.schedule[isWeekend ? 'weekend' : 'weekday']);
    if (subs.length === 0) {
      return res.status(500).json({ error: 'No active Hilogate credentials today' });
    }

    // Parse credentials
    const rawCreds = subs[0].credentials;
    let cfg: HilogateConfig;
    if (typeof rawCreds === 'string') {
      try {
        cfg = JSON.parse(rawCreds);
      } catch {
        return res.status(500).json({ error: 'Invalid credentials format' });
      }
    } else {
      cfg = rawCreds as unknown as HilogateConfig;
    }

    // Fetch bank list from Hilogate
    const client = new HilogateClient(cfg);
    try {
      banks = await client.getBankCodes();
    } catch {
      return res.status(500).json({ error: 'Error fetching bank list from Hilogate' });
    }

    // Return result
    return res.json({ banks });
    // 5) Cache for 1 hour (banks list rarely changes)
    await cacheSet(cacheKey, banks, 3600);

    // 6) Kembalikan hasil
    return res.json({ banks, cached: false });

  } catch {
    return res
      .status(500)
      .json({ error: 'Gagal mengambil daftar bank' });
  }
}

async function getBanksFromIna(req: Request, res: Response, provider: string) {
  try {
    // Find INA/ING1 merchant
    const merchant = await prisma.merchant.findFirst({
      where: { name: 'ing1' }
    });
    if (!merchant) {
      return res.status(500).json({ error: 'Internal ING1 merchant not found' });
    }

    const isWeekend = isJakartaWeekend(new Date());
    const allSubs = await prisma.sub_merchant.findMany({
      where: {
        merchantId: merchant.id,
        provider: 'ing1',
      }
    });
    const subs = allSubs.filter(s => s.schedule[isWeekend ? 'weekend' : 'weekday']);
    if (subs.length === 0) {
      return res.status(500).json({ error: 'No active ING1 credentials today' });
    }

    // INA Billers Engine supported banks for withdrawals (using 3-digit BI codes)
    // These are the banks supported by the cashout/payment API endpoint
    const banks = [
      { code: 'TRF_SINARMAS', product: 'Transfer ke Bank Sinarmas' },
      { code: 'TRF_BCA', product: 'Transfer Ke BCA' },
      { code: 'TRF_BNI', product: 'Transfer Ke BNI' },
      { code: 'TRF_MANDIRI', product: 'Transfer Ke MANDIRI' },
      { code: 'TRF_BRI', product: 'Transfer Ke BRI' },
      { code: 'TRF_SAHABAT_SAMPOERNA', product: 'Transfer ke Bank Sahabat Sampoerna' },
      { code: 'TRF_DANAMON', product: 'Transfer Ke DANAMON' },
      { code: 'TRF_ANZ', product: 'Transfer ke ANZ Indonesia' },
      { code: 'TRF_HARDA', product: 'Transfer ke Allo Bank/Bank Harda Internasional' },
      { code: 'TRF_ACEH', product: 'Transfer ke Bank Aceh Syariah' },
      { code: 'TRF_ALADIN', product: 'Transfer ke Bank Aladin Syariah' },
      { code: 'TRF_BTN_SYR', product: 'Transfer ke BTN Syariah' },
      { code: 'TRF_AMAR', product: 'Transfer ke Bank Amar Indonesia' },
      { code: 'TRF_ARTHA', product: 'Transfer ke Bank Artha Graha Internasional' },
      { code: 'TRF_BUKOPIN', product: 'Transfer ke Wokee/Bukopin' },
      { code: 'TRF_BENGKULU', product: 'Transfer ke Bank Bengkulu' },
      { code: 'TRF_DAERAH_ISTIMEWA', product: 'Transfer ke Bank BPD DIY' },
      { code: 'TRF_DAERAH_ISTIMEWA_SYR', product: 'Transfer ke Bank BPD DIY Syariah' },
      { code: 'TRF_UOB', product: 'Transfer ke TMRW/UOB' },
      { code: 'TRF_BTPN_SYR', product: 'Transfer ke Bank BTPN Syariah' },
      { code: 'TRF_BUKOPIN_SYR', product: 'Transfer ke Bank Bukopin Syariah' },
      { code: 'TRF_STANDARD_CHARTERED', product: 'Transfer ke Standard Chartered Bank' },
      { code: 'TRF_BUMI_ARTA', product: 'Transfer ke Bank Bumi Arta' },
      { code: 'TRF_CAPITAL', product: 'Transfer ke Bank Capital Indonesia' },
      { code: 'TRF_KESEJAHTERAAN_EKONOMI', product: 'Transfer ke Seabank/Bank BKE' },
      { code: 'TRF_CCB', product: 'Transfer ke Bank China Construction Bank Indonesia' },
      { code: 'TRF_CNB', product: 'Transfer ke Bank CNB (Centratama Nasional Bank)' },
      { code: 'TRF_SBI_INDONESIA', product: 'Transfer ke SBI Indonesia' },
      { code: 'TRF_DINAR', product: 'Transfer ke Bank Dinar Indonesia' },
      { code: 'TRF_DKI', product: 'Transfer ke Bank DKI' },
      { code: 'TRF_RABOBANK', product: 'Transfer ke Rabobank International Indonesia' },
      { code: 'TRF_DKI_SYR', product: 'Transfer ke Bank DKI Syariah' },
      { code: 'TRF_GANESHA', product: 'Transfer ke Bank Ganesha' },
      { code: 'TRF_QNB_KESAWAN', product: 'Transfer ke QNB Indonesia' },
      { code: 'TRF_AGRIS', product: 'Transfer ke Bank IBK Indonesia' },
      { code: 'TRF_INA_PERDANA', product: 'Transfer ke Bank Ina Perdana' },
      { code: 'TRF_PERMATA_SYR', product: 'Transfer ke Permata Syariah' },
      { code: 'TRF_INDEX_SELINDO', product: 'Transfer ke Bank Index Selindo' },
      { code: 'TRF_ARTOS_SYR', product: 'Transfer ke Bank Jago Syariah' },
      { code: 'TRF_PERMATA', product: 'Transfer ke Permata' },
      { code: 'TRF_JAMBI', product: 'Transfer ke Bank Jambi' },
      { code: 'TRF_JAMBI_SYR', product: 'Transfer ke Bank Jambi Syariah' },
      { code: 'TRF_JASA_JAKARTA', product: 'Transfer ke Bank Jasa Jakarta' },
      { code: 'TRF_JAWA_TENGAH', product: 'Transfer ke Bank Jateng' },
      { code: 'TRF_JAWA_TENGAH_SYR', product: 'Transfer ke Bank Jateng Syariah' },
      { code: 'TRF_JAWA_TIMUR', product: 'Transfer ke Bank Jatim' },
      { code: 'TRF_JAWA_TIMUR_SYR', product: 'Transfer ke Bank Jatim Syariah' },
      { code: 'TRF_KALIMANTAN_BARAT', product: 'Transfer ke Bank Kalbar' },
      { code: 'TRF_KALIMANTAN_BARAT_SYR', product: 'Transfer ke Bank Kalbar Syariah' },
      { code: 'TRF_KALIMANTAN_SELATAN', product: 'Transfer ke Bank Kalsel' },
      { code: 'TRF_KALIMANTAN_SELATAN_SYR', product: 'Transfer ke Bank Kalsel Syariah' },
      { code: 'TRF_KALIMANTAN_TENGAH', product: 'Transfer ke Bank Kalteng' },
      { code: 'TRF_KALIMANTAN_TIMUR_SYR', product: 'Transfer ke Bank Kaltim Syariah' },
      { code: 'TRF_KALIMANTAN_TIMUR', product: 'Transfer ke Bank Kaltimtara' },
      { code: 'TRF_LAMPUNG', product: 'Transfer ke Bank Lampung' },
      { code: 'TRF_MALUKU', product: 'Transfer ke Bank Maluku' },
      { code: 'TRF_MANTAP', product: 'Transfer ke Bank MANTAP (Mandiri Taspen)' },
      { code: 'TRF_MASPION', product: 'Transfer ke Bank Maspion Indonesia' },
      { code: 'TRF_MAYAPADA', product: 'Transfer ke Bank Mayapada' },
      { code: 'TRF_MAYORA', product: 'Transfer ke Bank Mayora Indonesia' },
      { code: 'TRF_MEGA', product: 'Transfer ke Bank Mega' },
      { code: 'TRF_MEGA_SYR', product: 'Transfer ke Bank Mega Syariah' },
      { code: 'TRF_MESTIKA_DHARMA', product: 'Transfer ke Bank Mestika Dharma' },
      { code: 'TRF_MIZUHO', product: 'Transfer ke Bank Mizuho Indonesia' },
      { code: 'TRF_MAS', product: 'Transfer ke Bank Multi Arta Sentosa (Bank MAS)' },
      { code: 'TRF_MUTIARA', product: 'Transfer ke Bank Mutiara' },
      { code: 'TRF_PANIN_SYR', product: 'Transfer ke Panin Dubai Syariah' },
      { code: 'TRF_SUMATERA_BARAT', product: 'Transfer ke Bank Nagari' },
      { code: 'TRF_SUMATERA_BARAT_SYR', product: 'Transfer ke Bank Nagari Syariah' },
      { code: 'TRF_PANIN', product: 'Transfer ke Panin Bank' },
      { code: 'TRF_NUSA_TENGGARA_BARAT', product: 'Transfer ke Bank NTB Syariah' },
      { code: 'TRF_NUSA_TENGGARA_TIMUR', product: 'Transfer ke Bank NTT' },
      { code: 'TRF_NATIONALNOBU', product: 'Transfer ke Nobu (Nationalnobu) Bank' },
      { code: 'TRF_NUSANTARA_PARAHYANGAN', product: 'Transfer ke Bank Nusantara Parahyangan' },
      { code: 'TRF_OCBC', product: 'Transfer ke Bank OCBC NISP' },
      { code: 'TRF_OCBC_SYR', product: 'Transfer ke Bank OCBC NISP Syariah' },
      { code: 'TRF_YUDHA_BAKTI', product: 'Transfer ke Neo Commerce/Yudha Bhakti' },
      { code: 'TRF_AMERICA_NA', product: 'Transfer ke Bank of America NA' },
      { code: 'TRF_BOC', product: 'Transfer ke Bank of China (Hong Kong) Limited' },
      { code: 'TRF_INDIA', product: 'Transfer ke Bank of India Indonesia' },
      { code: 'TRF_MUAMALAT', product: 'Transfer ke Muamalat' },
      { code: 'TRF_TOKYO', product: 'Transfer ke Bank of Tokyo Mitsubishi UFJ' },
      { code: 'TRF_PAPUA', product: 'Transfer ke Bank Papua' },
      { code: 'TRF_PRIMA', product: 'Transfer ke Bank Prima Master' },
      { code: 'TRF_MNC_INTERNASIONAL', product: 'Transfer ke Motion/MNC Bank' },
      { code: 'TRF_RIAU_DAN_KEPRI', product: 'Transfer ke Bank Riau Kepri' },
      { code: 'TRF_SHINHAN', product: 'Transfer ke Bank Bank Shinhan Indonesia' },
      { code: 'TRF_BII_SYR', product: 'Transfer ke Maybank Syariah' },
      { code: 'TRF_SINARMAS_SYR', product: 'Transfer ke Bank Sinarmas Syariah' },
      { code: 'TRF_SULSELBAR', product: 'Transfer ke Bank Sulselbar' },
      { code: 'TRF_BII', product: 'Transfer ke Maybank Indonesia' },
      { code: 'TRF_SULSELBAR_SYR', product: 'Transfer ke Bank Sulselbar Syariah' },
      { code: 'TRF_HANA', product: 'Transfer ke LINE Bank/KEB Hana' },
      { code: 'TRF_ARTOS', product: 'Transfer ke Jago/Artos' },
      { code: 'TRF_ICBC', product: 'Transfer ke ICBC Indonesia' },
      { code: 'TRF_SULAWESI', product: 'Transfer ke Bank Sulteng' },
      { code: 'TRF_HSBC', product: 'Transfer ke HSBC Indonesia' },
      { code: 'TRF_SULAWESI_TENGGARA', product: 'Transfer ke Bank Sultra' },
      { code: 'TRF_SULUT', product: 'Transfer ke Bank SulutGo' },
      { code: 'TRF_DBS', product: 'Transfer ke DBS Indonesia' },
      { code: 'TRF_SUMSEL_DAN_BABEL', product: 'Transfer ke Bank Sumsel Babel' },
      { code: 'TRF_CHINATRUST', product: 'Transfer ke CTBC (Chinatrust) Indonesia' },
      { code: 'TRF_SUMSEL_DAN_BABEL_SYR', product: 'Transfer ke Bank Sumsel Babel Syariah' },
      { code: 'TRF_SUMUT', product: 'Transfer ke Bank Sumut' },
      { code: 'TRF_SUMUT_SYR', product: 'Transfer ke Bank Sumut Syariah' },
      { code: 'TRF_COMMONWEALTH', product: 'Transfer ke Commonwealth Bank' },
      { code: 'TRF_RESONA_PERDANIA', product: 'Transfer ke Bank Resona Perdania' },
      { code: 'TRF_VICTORIA_INTERNASIONAL', product: 'Transfer ke Bank Victoria International' },
      { code: 'TRF_CITIBANK', product: 'Transfer ke Citibank' },
      { code: 'TRF_VICTORIA_SYR', product: 'Transfer ke Bank Victoria Syariah' },
      { code: 'TRF_WOORI', product: 'Transfer ke Bank Woori Saudara' },
      { code: 'TRF_CIMB', product: 'Transfer ke CIMB Niaga & CIMB Niaga Syariah' },
      { code: 'TRF_BCA_SYR', product: 'Transfer ke BCA (Bank Central Asia) Syariah' },
      { code: 'TRF_BJB', product: 'Transfer ke BJB' },
      { code: 'TRF_TABUNGAN_PENSIUNAN_NASIONAL', product: 'Transfer ke BTPN' },
      { code: 'TRF_BJB_SYR', product: 'Transfer ke BJB Syariah' },
      { code: 'TRF_BLU', product: 'Transfer ke Blu/BCA Digital' },
      { code: 'TRF_BTN', product: 'Transfer ke BTN' },
      { code: 'TRF_BNP_PARIBAS', product: 'Transfer ke BNP Paribas Indonesia' },
      { code: 'TRF_BALI', product: 'Transfer ke BPD Bali' },
      { code: 'TRF_BSI', product: 'Transfer ke BSI (Bank Syariah Indonesia)' },
      { code: 'TRF_BANTEN', product: 'Transfer ke BPD Banten' },
      { code: 'TRF_AGRONIAGA', product: 'Transfer ke BRI Agroniaga' },
      { code: 'OVOOPEN', product: 'OVO Wallet' },
      { code: 'GOPAYOPEN', product: 'Gopay Wallet' },
      { code: 'DANAOPEN', product: 'DANA Wallet' },
      { code: 'SHOPEEPAYOPEN', product: 'Shopee Pay Wallet' },
      { code: 'LINKAJAOPEN', product: 'Link Aaja Wallet' }
    ];

    // Return result
    return res.json({ banks });

  } catch (error) {
    console.error('getBanksFromIna error:', error);
    return res
      .status(500)
      .json({ error: 'Gagal mengambil daftar bank dari ING1' });
  }
}
