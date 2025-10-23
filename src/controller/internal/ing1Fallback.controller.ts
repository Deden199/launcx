import { Request, Response } from 'express';
import { prisma } from '../../core/prisma';
import { Ing1Client, Ing1Config } from '../../service/ing1Client';
import { parseIng1Date, parseIng1Number, processIng1Update } from '../../service/ing1Status';
import logger from '../../logger';

export async function manualResendCallback(req: Request, res: Response) {
  const { orderId } = req.params;
  try {
    // 1) Find order to get subMerchantId and pgRefId
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { subMerchantId: true, pgRefId: true, pgClientRef: true },
    });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!order.subMerchantId) {
      return res.status(400).json({ message: 'Order has no subMerchantId' });
    }

    // 2) Fetch sub-merchant credentials
    const sub = await prisma.sub_merchant.findUnique({
      where: { id: order.subMerchantId },
      select: { credentials: true, provider: true },
    });
    if (!sub || !sub.credentials) {
      return res.status(500).json({ message: 'ING1 credentials not found' });
    }

    if (sub.provider !== 'ing1') {
      return res.status(400).json({ message: 'Sub-merchant is not using ING1 provider' });
    }

    // 3) Parse credentials to Ing1Config
    let cfg: Ing1Config;
    const raw = sub.credentials as any;
    if (typeof raw === 'string') {
      cfg = JSON.parse(raw);
    } else {
      cfg = raw as Ing1Config;
    }

    const reff = order.pgRefId ?? undefined;
    const clientReff = order.pgClientRef ?? orderId;

    if (!reff) {
      return res.status(400).json({ message: 'Order has no pgRefId (reff)' });
    }

    const client = new Ing1Client(cfg);
    const resp = await client.checkCashin({ reff, clientReff });

    // Process the update
    const data = resp.data ?? {};
    await processIng1Update({
      orderId,
      rc: resp.rc,
      statusText: (data.status as string) ?? resp.status,
      billerReff: resp.reff ?? reff,
      clientReff: resp.clientReff ?? clientReff,
      grossAmount:
        parseIng1Number(data.total ?? data.amount ?? data.gross_amount ?? data.grossAmount) ?? undefined,
      paymentReceivedTime:
        parseIng1Date(data.paid_at ?? data.payment_received_time ?? data.paidAt) ?? undefined,
      settlementTime:
        parseIng1Date(data.settlement_time ?? data.settled_at ?? data.settlementTime) ?? undefined,
      expirationTime:
        parseIng1Date(data.expired_at ?? data.expiration_time ?? data.expirationTime) ?? undefined,
    });

    logger.info('[manualResendCallback] ING1 result', { orderId, result: resp });

    return res.json({ success: true, result: resp });
  } catch (err: any) {
    logger.error('[manualResendCallback] ING1 error', { orderId, error: err?.message });
    return res.status(500).json({ message: 'Failed to resend callback', error: err?.message });
  }
}
