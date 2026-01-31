// scripts/trigger-ledger.ts
import { config } from 'dotenv';
config({ path: '.env' });

import { processOrderSettlement } from '../dist/service/ledger.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const orderId = process.argv[2];
  if (!orderId) {
    console.error('Usage: npx ts-node scripts/trigger-ledger.ts <orderId>');
    process.exit(1);
  }

  console.log('Processing order:', orderId);
  
  const result = await processOrderSettlement(orderId);
  console.log('Ledger result:', result);

  // Check balances
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { partnerClientId: true }
  });

  if (order?.partnerClientId) {
    const client = await prisma.partnerClient.findUnique({
      where: { id: order.partnerClientId },
      select: { balance: true, name: true }
    });
    console.log('Client balance after:', client?.name, '=', client?.balance);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
