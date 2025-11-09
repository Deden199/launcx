// File: src/controllers/bank.controller.ts

import { Request, Response } from 'express';
import { prisma } from '../core/prisma';
import { HilogateClient, HilogateConfig } from '../service/hilogateClient';
import { isJakartaWeekend } from '../util/time'

export async function getBanks(req: Request, res: Response) {
  try {
    console.log("=== [getBanks] Start fetching Hilogate bank list ===");

    // 1️⃣ Cari internal merchant Hilogate
    const merchant = await prisma.merchant.findFirst({
      where: { name: 'hilogate' }
    });
    console.log("Merchant result:", merchant);

    if (!merchant) {
      console.error("❌ Merchant 'hilogate' not found in DB");
      return res.status(500).json({ error: 'Internal Hilogate merchant not found' });
    }

    // 2️⃣ Ambil sub_merchant list
    const isWeekend = isJakartaWeekend(new Date());
    console.log("Today is weekend?", isWeekend);

    const allSubs = await prisma.sub_merchant.findMany({
      where: {
        merchantId: merchant.id,
        provider: 'hilogate',
      }
    });
    console.log("Total sub-merchants found:", allSubs.length);

    const subs = allSubs.filter(s => s.schedule?.[isWeekend ? 'weekend' : 'weekday']);
    console.log("Active sub-merchants today:", subs.map(s => s.name || s.id));

    if (subs.length === 0) {
      console.error("❌ No active Hilogate sub-merchants found for today");
      return res.status(500).json({ error: 'No active Hilogate credentials today' });
    }

    // 3️⃣ Parse credentials
    const rawCreds = subs[0].credentials;
    console.log("Raw credentials type:", typeof rawCreds);

    let cfg: HilogateConfig;
    if (typeof rawCreds === 'string') {
      try {
        cfg = JSON.parse(rawCreds);
      } catch (err) {
        console.error("❌ Failed to parse credentials JSON:", err);
        return res.status(500).json({ error: 'Invalid credentials format' });
      }
    } else {
      cfg = rawCreds as unknown as HilogateConfig;
    }

    console.log("✅ Parsed Hilogate config:", {
      merchant_id: cfg.merchantId,
      client_id: cfg.merchantId,
      base_url: cfg.env,
    });

    // 4️⃣ Panggil API untuk daftar bank
    const client = new HilogateClient(cfg);
    let banks;
    try {
      console.log("Calling Hilogate API for bank list...");
      banks = await client.getBankCodes();
      console.log("✅ Hilogate API response received:", Array.isArray(banks) ? banks.length : banks);
    } catch (err) {
      console.error("❌ Error fetching bank list from Hilogate:", err);
      return res.status(500).json({ error: 'Error fetching bank list from Hilogate' });
    }

    // 5️⃣ Kembalikan hasil
    console.log("=== [getBanks] Successfully returning bank list ===");
    return res.json({ banks });

  } catch (err) {
    console.error("💥 Unexpected error in getBanks:", err);
    return res
      .status(500)
      .json({ error: 'Gagal mengambil daftar bank dari Hilogate' });
  }
}

