// File: src/controllers/bank.controller.ts

import { Request, Response } from 'express';
import { prisma } from '../core/prisma';
import { HilogateClient, HilogateConfig } from '../service/hilogateClient';
import { Ing1Client, Ing1Config } from '../service/ing1Client';
import { isJakartaWeekend } from '../util/time'

export async function getBanks(req: Request, res: Response) {
  try {
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
        console.log('Fetching bank codes from JSON...');
        console.log(cfg);
      } catch {
        return res.status(500).json({ error: 'Invalid credentials format' });
      }
    } else {
      cfg = rawCreds as unknown as HilogateConfig;
    }

    // Fetch bank list from Hilogate
    const client = new HilogateClient(cfg);
    let banks;
    try {
      banks = await client.getBankCodes();
      console.log('Fetching bank codes from Hilogate...');
      console.log(banks);
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
      { code: 'TRF_SINARMAS', name: 'Transfer ke Bank Sinarmas' },
      { code: 'TRF_BCA', name: 'Transfer Ke BCA' },
      { code: 'TRF_BNI', name: 'Transfer Ke BNI' },
      { code: 'TRF_MANDIRI', name: 'Transfer Ke MANDIRI' },
      { code: 'TRF_BRI', name: 'Transfer Ke BRI' },
      { code: 'TRF_SAHABAT_SAMPOERNA', name: 'Transfer ke Bank Sahabat Sampoerna' },
      { code: 'TRF_DANAMON', name: 'Transfer Ke DANAMON' },
      { code: 'TRF_ANZ', name: 'Transfer ke ANZ Indonesia' },
      { code: 'TRF_HARDA', name: 'Transfer ke Allo Bank/Bank Harda Internasional' },
      { code: 'TRF_ACEH', name: 'Transfer ke Bank Aceh Syariah' },
      { code: 'TRF_ALADIN', name: 'Transfer ke Bank Aladin Syariah' },
      { code: 'TRF_BTN_SYR', name: 'Transfer ke BTN Syariah' },
      { code: 'TRF_AMAR', name: 'Transfer ke Bank Amar Indonesia' },
      { code: 'TRF_ARTHA', name: 'Transfer ke Bank Artha Graha Internasional' },
      { code: 'TRF_BUKOPIN', name: 'Transfer ke Wokee/Bukopin' },
      { code: 'TRF_BENGKULU', name: 'Transfer ke Bank Bengkulu' },
      { code: 'TRF_DAERAH_ISTIMEWA', name: 'Transfer ke Bank BPD DIY' },
      { code: 'TRF_DAERAH_ISTIMEWA_SYR', name: 'Transfer ke Bank BPD DIY Syariah' },
      { code: 'TRF_UOB', name: 'Transfer ke TMRW/UOB' },
      { code: 'TRF_BTPN_SYR', name: 'Transfer ke Bank BTPN Syariah' },
      { code: 'TRF_BUKOPIN_SYR', name: 'Transfer ke Bank Bukopin Syariah' },
      { code: 'TRF_STANDARD_CHARTERED', name: 'Transfer ke Standard Chartered Bank' },
      { code: 'TRF_BUMI_ARTA', name: 'Transfer ke Bank Bumi Arta' },
      { code: 'TRF_CAPITAL', name: 'Transfer ke Bank Capital Indonesia' },
      { code: 'TRF_KESEJAHTERAAN_EKONOMI', name: 'Transfer ke Seabank/Bank BKE' },
      { code: 'TRF_CCB', name: 'Transfer ke Bank China Construction Bank Indonesia' },
      { code: 'TRF_CNB', name: 'Transfer ke Bank CNB (Centratama Nasional Bank)' },
      { code: 'TRF_SBI_INDONESIA', name: 'Transfer ke SBI Indonesia' },
      { code: 'TRF_DINAR', name: 'Transfer ke Bank Dinar Indonesia' },
      { code: 'TRF_DKI', name: 'Transfer ke Bank DKI' },
      { code: 'TRF_RABOBANK', name: 'Transfer ke Rabobank International Indonesia' },
      { code: 'TRF_DKI_SYR', name: 'Transfer ke Bank DKI Syariah' },
      { code: 'TRF_GANESHA', name: 'Transfer ke Bank Ganesha' },
      { code: 'TRF_QNB_KESAWAN', name: 'Transfer ke QNB Indonesia' },
      { code: 'TRF_AGRIS', name: 'Transfer ke Bank IBK Indonesia' },
      { code: 'TRF_INA_PERDANA', name: 'Transfer ke Bank Ina Perdana' },
      { code: 'TRF_PERMATA_SYR', name: 'Transfer ke Permata Syariah' },
      { code: 'TRF_INDEX_SELINDO', name: 'Transfer ke Bank Index Selindo' },
      { code: 'TRF_ARTOS_SYR', name: 'Transfer ke Bank Jago Syariah' },
      { code: 'TRF_PERMATA', name: 'Transfer ke Permata' },
      { code: 'TRF_JAMBI', name: 'Transfer ke Bank Jambi' },
      { code: 'TRF_JAMBI_SYR', name: 'Transfer ke Bank Jambi Syariah' },
      { code: 'TRF_JASA_JAKARTA', name: 'Transfer ke Bank Jasa Jakarta' },
      { code: 'TRF_JAWA_TENGAH', name: 'Transfer ke Bank Jateng' },
      { code: 'TRF_JAWA_TENGAH_SYR', name: 'Transfer ke Bank Jateng Syariah' },
      { code: 'TRF_JAWA_TIMUR', name: 'Transfer ke Bank Jatim' },
      { code: 'TRF_JAWA_TIMUR_SYR', name: 'Transfer ke Bank Jatim Syariah' },
      { code: 'TRF_KALIMANTAN_BARAT', name: 'Transfer ke Bank Kalbar' },
      { code: 'TRF_KALIMANTAN_BARAT_SYR', name: 'Transfer ke Bank Kalbar Syariah' },
      { code: 'TRF_KALIMANTAN_SELATAN', name: 'Transfer ke Bank Kalsel' },
      { code: 'TRF_KALIMANTAN_SELATAN_SYR', name: 'Transfer ke Bank Kalsel Syariah' },
      { code: 'TRF_KALIMANTAN_TENGAH', name: 'Transfer ke Bank Kalteng' },
      { code: 'TRF_KALIMANTAN_TIMUR_SYR', name: 'Transfer ke Bank Kaltim Syariah' },
      { code: 'TRF_KALIMANTAN_TIMUR', name: 'Transfer ke Bank Kaltimtara' },
      { code: 'TRF_LAMPUNG', name: 'Transfer ke Bank Lampung' },
      { code: 'TRF_MALUKU', name: 'Transfer ke Bank Maluku' },
      { code: 'TRF_MANTAP', name: 'Transfer ke Bank MANTAP (Mandiri Taspen)' },
      { code: 'TRF_MASPION', name: 'Transfer ke Bank Maspion Indonesia' },
      { code: 'TRF_MAYAPADA', name: 'Transfer ke Bank Mayapada' },
      { code: 'TRF_MAYORA', name: 'Transfer ke Bank Mayora Indonesia' },
      { code: 'TRF_MEGA', name: 'Transfer ke Bank Mega' },
      { code: 'TRF_MEGA_SYR', name: 'Transfer ke Bank Mega Syariah' },
      { code: 'TRF_MESTIKA_DHARMA', name: 'Transfer ke Bank Mestika Dharma' },
      { code: 'TRF_MIZUHO', name: 'Transfer ke Bank Mizuho Indonesia' },
      { code: 'TRF_MAS', name: 'Transfer ke Bank Multi Arta Sentosa (Bank MAS)' },
      { code: 'TRF_MUTIARA', name: 'Transfer ke Bank Mutiara' },
      { code: 'TRF_PANIN_SYR', name: 'Transfer ke Panin Dubai Syariah' },
      { code: 'TRF_SUMATERA_BARAT', name: 'Transfer ke Bank Nagari' },
      { code: 'TRF_SUMATERA_BARAT_SYR', name: 'Transfer ke Bank Nagari Syariah' },
      { code: 'TRF_PANIN', name: 'Transfer ke Panin Bank' },
      { code: 'TRF_NUSA_TENGGARA_BARAT', name: 'Transfer ke Bank NTB Syariah' },
      { code: 'TRF_NUSA_TENGGARA_TIMUR', name: 'Transfer ke Bank NTT' },
      { code: 'TRF_NATIONALNOBU', name: 'Transfer ke Nobu (Nationalnobu) Bank' },
      { code: 'TRF_NUSANTARA_PARAHYANGAN', name: 'Transfer ke Bank Nusantara Parahyangan' },
      { code: 'TRF_OCBC', name: 'Transfer ke Bank OCBC NISP' },
      { code: 'TRF_OCBC_SYR', name: 'Transfer ke Bank OCBC NISP Syariah' },
      { code: 'TRF_YUDHA_BAKTI', name: 'Transfer ke Neo Commerce/Yudha Bhakti' },
      { code: 'TRF_AMERICA_NA', name: 'Transfer ke Bank of America NA' },
      { code: 'TRF_BOC', name: 'Transfer ke Bank of China (Hong Kong) Limited' },
      { code: 'TRF_INDIA', name: 'Transfer ke Bank of India Indonesia' },
      { code: 'TRF_MUAMALAT', name: 'Transfer ke Muamalat' },
      { code: 'TRF_TOKYO', name: 'Transfer ke Bank of Tokyo Mitsubishi UFJ' },
      { code: 'TRF_PAPUA', name: 'Transfer ke Bank Papua' },
      { code: 'TRF_PRIMA', name: 'Transfer ke Bank Prima Master' },
      { code: 'TRF_MNC_INTERNASIONAL', name: 'Transfer ke Motion/MNC Bank' },
      { code: 'TRF_RIAU_DAN_KEPRI', name: 'Transfer ke Bank Riau Kepri' },
      { code: 'TRF_SHINHAN', name: 'Transfer ke Bank Bank Shinhan Indonesia' },
      { code: 'TRF_BII_SYR', name: 'Transfer ke Maybank Syariah' },
      { code: 'TRF_SINARMAS_SYR', name: 'Transfer ke Bank Sinarmas Syariah' },
      { code: 'TRF_SULSELBAR', name: 'Transfer ke Bank Sulselbar' },
      { code: 'TRF_BII', name: 'Transfer ke Maybank Indonesia' },
      { code: 'TRF_SULSELBAR_SYR', name: 'Transfer ke Bank Sulselbar Syariah' },
      { code: 'TRF_HANA', name: 'Transfer ke LINE Bank/KEB Hana' },
      { code: 'TRF_ARTOS', name: 'Transfer ke Jago/Artos' },
      { code: 'TRF_ICBC', name: 'Transfer ke ICBC Indonesia' },
      { code: 'TRF_SULAWESI', name: 'Transfer ke Bank Sulteng' },
      { code: 'TRF_HSBC', name: 'Transfer ke HSBC Indonesia' },
      { code: 'TRF_SULAWESI_TENGGARA', name: 'Transfer ke Bank Sultra' },
      { code: 'TRF_SULUT', name: 'Transfer ke Bank SulutGo' },
      { code: 'TRF_DBS', name: 'Transfer ke DBS Indonesia' },
      { code: 'TRF_SUMSEL_DAN_BABEL', name: 'Transfer ke Bank Sumsel Babel' },
      { code: 'TRF_CHINATRUST', name: 'Transfer ke CTBC (Chinatrust) Indonesia' },
      { code: 'TRF_SUMSEL_DAN_BABEL_SYR', name: 'Transfer ke Bank Sumsel Babel Syariah' },
      { code: 'TRF_SUMUT', name: 'Transfer ke Bank Sumut' },
      { code: 'TRF_SUMUT_SYR', name: 'Transfer ke Bank Sumut Syariah' },
      { code: 'TRF_COMMONWEALTH', name: 'Transfer ke Commonwealth Bank' },
      { code: 'TRF_RESONA_PERDANIA', name: 'Transfer ke Bank Resona Perdania' },
      { code: 'TRF_VICTORIA_INTERNASIONAL', name: 'Transfer ke Bank Victoria International' },
      { code: 'TRF_CITIBANK', name: 'Transfer ke Citibank' },
      { code: 'TRF_VICTORIA_SYR', name: 'Transfer ke Bank Victoria Syariah' },
      { code: 'TRF_WOORI', name: 'Transfer ke Bank Woori Saudara' },
      { code: 'TRF_CIMB', name: 'Transfer ke CIMB Niaga & CIMB Niaga Syariah' },
      { code: 'TRF_BCA_SYR', name: 'Transfer ke BCA (Bank Central Asia) Syariah' },
      { code: 'TRF_BJB', name: 'Transfer ke BJB' },
      { code: 'TRF_TABUNGAN_PENSIUNAN_NASIONAL', name: 'Transfer ke BTPN' },
      { code: 'TRF_BJB_SYR', name: 'Transfer ke BJB Syariah' },
      { code: 'TRF_BLU', name: 'Transfer ke Blu/BCA Digital' },
      { code: 'TRF_BTN', name: 'Transfer ke BTN' },
      { code: 'TRF_BNP_PARIBAS', name: 'Transfer ke BNP Paribas Indonesia' },
      { code: 'TRF_BALI', name: 'Transfer ke BPD Bali' },
      { code: 'TRF_BSI', name: 'Transfer ke BSI (Bank Syariah Indonesia)' },
      { code: 'TRF_BANTEN', name: 'Transfer ke BPD Banten' },
      { code: 'TRF_AGRONIAGA', name: 'Transfer ke BRI Agroniaga' },
      { code: 'OVOOPEN', name: 'OVO Wallet' },
      { code: 'GOPAYOPEN', name: 'Gopay Wallet' },
      { code: 'DANAOPEN', name: 'DANA Wallet' },
      { code: 'SHOPEEPAYOPEN', name: 'Shopee Pay Wallet' },
      { code: 'LINKAJAOPEN', name: 'Link Aaja Wallet' }
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
