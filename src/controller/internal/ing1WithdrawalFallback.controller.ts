import { Request, Response } from 'express';
import { prisma } from '../../core/prisma';
import { Ing1Client, Ing1Config } from '../../service/ing1Client';
import { parseIng1Date, parseIng1Number } from '../../service/ing1Status';
import logger from '../../logger';
import { DisbursementStatus } from '@prisma/client';

const mapIng1ToDisbursement = (
  rc?: number | null,
  statusText?: string | null
): DisbursementStatus => {
  if (rc === 0) return DisbursementStatus.COMPLETED;
  if (rc === 91) return DisbursementStatus.PENDING;

  const normalized = (statusText || '').toUpperCase();
  if (['PAID', 'SUCCESS', 'COMPLETED'].includes(normalized)) {
    return DisbursementStatus.COMPLETED;
  }
  if (['PENDING', 'PROCESS', 'PROCESSING'].includes(normalized)) {
    return DisbursementStatus.PENDING;
  }
  return DisbursementStatus.FAILED;
};

export async function manualResendWithdrawalCallback(req: Request, res: Response) {
  const { refId } = req.params;
  try {
    // 1) Find withdrawal to get subMerchantId and paymentGatewayId
    const withdrawal = await prisma.withdrawRequest.findUnique({
      where: { refId },
      select: {
        subMerchantId: true,
        paymentGatewayId: true,
        refId: true,
        partnerClientId: true,
        amount: true,
        status: true,
        sourceProvider: true,
      },
    });
    if (!withdrawal) {
      return res.status(404).json({ message: 'Withdrawal not found' });
    }

    if (!withdrawal.subMerchantId) {
      return res.status(400).json({ message: 'Withdrawal has no subMerchantId' });
    }

    // 2) Fetch sub-merchant credentials
    const sub = await prisma.sub_merchant.findUnique({
      where: { id: withdrawal.subMerchantId },
      select: { credentials: true, provider: true },
    });
    if (!sub || !sub.credentials) {
      return res.status(500).json({ message: 'ING1 credentials not found' });
    }

    if (sub.provider !== 'ing1' && withdrawal.sourceProvider !== 'ing1') {
      return res.status(400).json({ message: 'Withdrawal is not using ING1 provider' });
    }

    // 3) Parse credentials to Ing1Config
    let cfg: Ing1Config;
    const raw = sub.credentials as any;
    if (typeof raw === 'string') {
      cfg = JSON.parse(raw);
    } else {
      cfg = raw as Ing1Config;
    }

    const reff = withdrawal.paymentGatewayId ?? undefined;
    const clientReff = refId;

    if (!reff) {
      return res.status(400).json({ message: 'Withdrawal has no paymentGatewayId (reff)' });
    }

    const client = new Ing1Client(cfg);
    const resp = await client.checkCashout({ reff, clientReff });

    // Process the update
    const data = resp.data ?? {};
    const newStatus = mapIng1ToDisbursement(resp.rc, (data.status as string) ?? resp.status);

    const updateData: any = {
      status: newStatus,
    };

    if (resp.reff) {
      updateData.paymentGatewayId = resp.reff;
    }

    const feeRaw = parseIng1Number(
      data.fee ?? data.total_fee ?? data.admin_fee?.total_fee ?? null
    );
    if (feeRaw != null) {
      updateData.pgFee = feeRaw;
    }

    const completedAt = parseIng1Date(
      data.completed_at ?? data.settlement_time ?? data.paid_at ?? null
    );
    if (completedAt) {
      updateData.completedAt = completedAt;
    }

    await prisma.withdrawRequest.update({
      where: { refId },
      data: updateData,
    });

    // Handle balance adjustments
    if (withdrawal.status !== newStatus) {
      if (withdrawal.status === DisbursementStatus.PENDING && newStatus === DisbursementStatus.FAILED) {
        await prisma.partnerClient.update({
          where: { id: withdrawal.partnerClientId },
          data: { balance: { increment: withdrawal.amount } },
        });
      } else if (
        withdrawal.status === DisbursementStatus.FAILED &&
        newStatus === DisbursementStatus.COMPLETED
      ) {
        await prisma.partnerClient.update({
          where: { id: withdrawal.partnerClientId },
          data: { balance: { decrement: withdrawal.amount } },
        });
      }
    }

    logger.info('[manualResendWithdrawalCallback] ING1 result', { refId, result: resp });

    return res.json({ success: true, result: resp, oldStatus: withdrawal.status, newStatus });
  } catch (err: any) {
    logger.error('[manualResendWithdrawalCallback] ING1 error', { refId, error: err?.message });
    return res.status(500).json({ message: 'Failed to resend callback', error: err?.message });
  }
}
