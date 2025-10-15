import { DisbursementStatus } from '@prisma/client';
import { prisma } from '../src/core/prisma';

async function findNegativeBalances() {
  console.log('Starting negative balance check...');

  // Get all submerchants
  const submerchants = await prisma.sub_merchant.findMany({
    select: { id: true, name: true, provider: true }
  });

  console.log(`Found ${submerchants.length} submerchants to check`);

  const subIds = submerchants.map(sm => sm.id);

  // OPTIMIZED: Batch aggregate ALL settlements at once using groupBy
  const settlementsGrouped = await prisma.order.groupBy({
    by: ['subMerchantId'],
    where: {
      subMerchantId: { in: subIds },
      settlementTime: { not: null }
    },
    _sum: { settlementAmount: true },
  });

  // OPTIMIZED: Batch aggregate ALL withdrawals at once using groupBy
  const withdrawalsGrouped = await prisma.withdrawRequest.groupBy({
    by: ['subMerchantId'],
    where: {
      subMerchantId: { in: subIds },
      status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] }
    },
    _sum: { netAmount: true, pgFee: true },
  });

  // Build lookup maps for O(1) access
  const settleMap = new Map<string, number>();
  settlementsGrouped.forEach(g => {
    settleMap.set(g.subMerchantId, g._sum.settlementAmount ?? 0);
  });

  const withdrawMap = new Map<string, { netAmount: number; pgFee: number }>();
  withdrawalsGrouped.forEach(g => {
    withdrawMap.set(g.subMerchantId, {
      netAmount: g._sum.netAmount ?? 0,
      pgFee: g._sum.pgFee ?? 0
    });
  });

  const negativeBalances = [];

  // Check each submerchant's balance (now using pre-fetched data)
  for (const sm of submerchants) {
    const totalIn = settleMap.get(sm.id) ?? 0;
    const withdraw = withdrawMap.get(sm.id) ?? { netAmount: 0, pgFee: 0 };
    const totalOut = withdraw.netAmount + withdraw.pgFee;
    const balance = totalIn - totalOut;

    if (balance < 0) {
      console.log(`Negative balance found for ${sm.name} (${sm.id}): ${balance}`);

      // Only fetch withdrawals for negative balances (lazy load)
      const withdrawals = await prisma.withdrawRequest.findMany({
        where: {
          subMerchantId: sm.id,
          status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] }
        },
        orderBy: { createdAt: 'desc' },
        take: 5, // Only fetch top 5 for performance
        select: {
          id: true,
          refId: true,
          amount: true,
          netAmount: true,
          pgFee: true,
          status: true,
          createdAt: true,
          partnerClientId: true,
          partnerClient: { select: { name: true } }
        }
      });

      negativeBalances.push({
        subMerchant: sm,
        balance,
        totalIn,
        totalOut,
        withdrawals,
        withdrawalCount: withdrawals.length
      });
    }
  }

  // Output the results
  console.log('\n=== Negative Balance Report ===');
  console.log(`Found ${negativeBalances.length} submerchants with negative balances`);

  for (const item of negativeBalances) {
    console.log(`\n${item.subMerchant.name} (${item.subMerchant.id}):`);
    console.log(`  Balance: ${item.balance}`);
    console.log(`  Total In: ${item.totalIn}`);
    console.log(`  Total Out: ${item.totalOut}`);
    console.log(`  Recent Withdrawals (${Math.min(5, item.withdrawalCount)} of ${item.withdrawalCount}):`);

    for (const w of item.withdrawals) {
      console.log(`    - ${w.refId}: ${w.amount} (${w.status}) on ${w.createdAt.toISOString()} by ${w.partnerClient.name}`);
    }
  }
}

// Execute the function
findNegativeBalances()
  .then(() => console.log('Check completed.'))
  .catch(e => console.error('Error checking balances:', e))
  .finally(() => prisma.$disconnect());
