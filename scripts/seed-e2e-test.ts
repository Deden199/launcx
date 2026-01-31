// scripts/seed-e2e-test.ts
// Seed data untuk E2E testing VA Payment → Settlement → Withdrawal dengan DanaRapay

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting E2E Test Seed...\n');

  // 1. Create test merchant
  const merchantId = '679d5e6e4a3b2c1d0e9f8a7b'; // Fixed ObjectId for reference
  let merchant = await prisma.merchant.findFirst({
    where: { email: 'e2e-test@launcx.id' }
  });

  if (!merchant) {
    merchant = await prisma.merchant.create({
      data: {
        id: merchantId,
        phoneNumber: '081234567890',
        name: 'E2E Test Merchant',
        email: 'e2e-test@launcx.id',
        mdr: 0.7,
      }
    });
    console.log('✅ Created merchant:', merchant.id);
  } else {
    console.log('ℹ️  Merchant already exists:', merchant.id);
  }

  // 2. Create sub_merchant with DanaRapay provider
  let subMerchant = await prisma.sub_merchant.findFirst({
    where: { 
      merchantId: merchant.id,
      provider: 'danarapay'
    }
  });

  if (!subMerchant) {
    subMerchant = await prisma.sub_merchant.create({
      data: {
        merchantId: merchant.id,
        provider: 'danarapay',
        name: 'DanaRapay E2E Wallet',
        fee: 0.7,
        credentials: {
          // Credentials diambil dari ENV, bukan disimpan di DB
          useGlobalCredentials: true
        },
        schedule: {
          weekday: true,
          weekend: true
        }
      }
    });
    console.log('✅ Created sub_merchant (DanaRapay):', subMerchant.id);
  } else {
    console.log('ℹ️  Sub_merchant already exists:', subMerchant.id);
  }

  // 3. Create PartnerClient (for client dashboard login)
  const apiKey = 'e2e-test-api-key-' + randomUUID().slice(0, 8);
  const apiSecret = randomUUID();
  
  let partnerClient = await prisma.partnerClient.findFirst({
    where: { name: 'E2E Test Client' }
  });

  if (!partnerClient) {
    partnerClient = await prisma.partnerClient.create({
      data: {
        name: 'E2E Test Client',
        apiKey: apiKey,
        apiSecret: apiSecret,
        isActive: true,
        feePercent: 1.0,
        feeFlat: 0,
        balance: 1000000, // Start with 1jt balance for testing WD
        defaultProvider: 'danarapay',
        withdrawFeePercent: 0.5,
        withdrawFeeFlat: 2500,
        weekendFeePercent: 1.0,
        weekendFeeFlat: 5000,
        callbackUrl: 'https://webhook.site/test-callback',
        allowedDomains: ['*'],
      }
    });
    console.log('✅ Created PartnerClient:', partnerClient.id);
    console.log('   API Key:', apiKey);
    console.log('   API Secret:', apiSecret);
  } else {
    console.log('ℹ️  PartnerClient already exists:', partnerClient.id);
    console.log('   API Key:', partnerClient.apiKey);
  }

  // 4. Create ClientUser for web login
  const passwordHash = await bcrypt.hash('Test@12345', 10);
  
  let clientUser = await prisma.clientUser.findFirst({
    where: { email: 'e2e@launcx.id' }
  });

  if (!clientUser) {
    clientUser = await prisma.clientUser.create({
      data: {
        partnerClientId: partnerClient.id,
        email: 'e2e@launcx.id',
        password: passwordHash,
        role: 'PARTNER_CLIENT',
        isActive: true,
        totpEnabled: false, // Disable 2FA for testing
      }
    });
    console.log('✅ Created ClientUser:', clientUser.id);
    console.log('   Email: e2e@launcx.id');
    console.log('   Password: Test@12345');
  } else {
    console.log('ℹ️  ClientUser already exists:', clientUser.id);
  }

  // 5. Initialize SubMerchantBalance if not exists
  let subBalance = await prisma.subMerchantBalance.findFirst({
    where: { subMerchantId: subMerchant.id }
  });

  if (!subBalance) {
    subBalance = await prisma.subMerchantBalance.create({
      data: {
        subMerchantId: subMerchant.id,
        availableBalance: 1000000, // 1jt initial balance
      }
    });
    console.log('✅ Created SubMerchantBalance:', subBalance.id);
    console.log('   Initial Balance: Rp 1,000,000');
  } else {
    console.log('ℹ️  SubMerchantBalance already exists, balance:', subBalance.availableBalance);
  }

  console.log('\n========================================');
  console.log('📋 E2E TEST CREDENTIALS:');
  console.log('========================================');
  console.log('');
  console.log('🔐 Client Web Login:');
  console.log('   Email: e2e@launcx.id');
  console.log('   Password: Test@12345');
  console.log('');
  console.log('🔑 API Credentials:');
  console.log('   API Key:', partnerClient.apiKey);
  console.log('   API Secret:', partnerClient.apiSecret || apiSecret);
  console.log('');
  console.log('📦 IDs for Testing:');
  console.log('   PartnerClient ID:', partnerClient.id);
  console.log('   SubMerchant ID:', subMerchant.id);
  console.log('   Merchant ID:', merchant.id);
  console.log('');
  console.log('💰 Initial Balances:');
  console.log('   PartnerClient Balance: Rp', partnerClient.balance.toLocaleString());
  console.log('   SubMerchant Balance: Rp', subBalance.availableBalance.toLocaleString());
  console.log('========================================\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
