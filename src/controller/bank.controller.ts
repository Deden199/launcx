// File: src/controllers/bank.controller.ts

import { Request, Response } from 'express';
import { prisma } from '../core/prisma';
import { HilogateClient, HilogateConfig } from '../service/hilogateClient';
import { isJakartaWeekend } from '../util/time'
import { cacheGet, cacheSet } from '../core/redis';

export async function getBanks(req: Request, res: Response) {
  try {
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

    // 3) Parse kredensial
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

    // 4) Panggil API untuk daftar bank
    const client = new HilogateClient(cfg);
    let banks;
    try {
      banks = await client.getBankCodes();
    } catch {
      return res.status(500).json({ error: 'Error fetching bank list from Hilogate' });
    }

    // 5) Cache for 1 hour (banks list rarely changes)
    await cacheSet(cacheKey, banks, 3600);

    // 6) Kembalikan hasil
    return res.json({ banks, cached: false });

  } catch {
    return res
      .status(500)
      .json({ error: 'Gagal mengambil daftar bank dari Hilogate' });
  }
}
