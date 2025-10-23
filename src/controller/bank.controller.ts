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

    // INA Billers Engine supported banks for withdrawals
    // These are the banks supported by the cashout/payment API endpoint
    const banks = [
      { code: 'BCA', name: 'Bank Central Asia' },
      { code: 'BNI', name: 'Bank Negara Indonesia' },
      { code: 'MANDIRI', name: 'Bank Mandiri' },
      { code: 'BRI', name: 'Bank Rakyat Indonesia' },
      { code: 'CIMB', name: 'CIMB Niaga' },
      { code: 'MAYBANK', name: 'Maybank' },
      { code: 'PERMATA', name: 'Bank Permata' },
      { code: 'DANAMON', name: 'Bank Danamon' },
      { code: 'OKE', name: 'Bank OKE' },
      { code: 'MEGA', name: 'Bank Mega' },
      { code: 'BTN', name: 'Bank Tabungan Negara' },
      { code: 'BSI', name: 'Bank Syariah Indonesia' },
      { code: 'PANIN', name: 'Bank Panin' },
      { code: 'OCBC', name: 'OCBC NISP' },
      { code: 'UOB', name: 'UOB Bank' },
      { code: 'DBS', name: 'Bank DBS' },
      { code: 'HSBC', name: 'HSBC Bank' }
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
