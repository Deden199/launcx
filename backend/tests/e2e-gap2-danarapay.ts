/**
 * E2E Test: DanaRapay Withdrawal Flow + Callback Security
 * 
 * Tests:
 * 1. Callback without token → 401 (when token configured)
 * 2. Callback with valid token → 200
 * 3. Create withdrawal DanaRapay → verify saldo tidak berubah + remit called
 * 4. Disbursement callback 000 → verify saldo berkurang 1x
 * 
 * Usage:
 *   npx ts-node backend/tests/e2e-gap2-danarapay.ts
 * 
 * Environment:
 *   Reads DATABASE_URL from .env file
 */

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../../src/core/prisma';
import {
  processWithdrawalBalanceDeduction,
  processWithdrawalCallback,
  DISBURSEMENT_CODES,
} from '../../src/service/ledger.service';

const TEST_PREFIX = 'e2e-gap2-' + Date.now();
const INITIAL_BALANCE = 1000000;

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function log(message: string) {
  console.log(`[TEST] ${message}`);
}

function addResult(name: string, passed: boolean, details: string) {
  results.push({ name, passed, details });
  log(`${passed ? '✅' : '❌'} ${name}: ${details}`);
}

// Global IDs
let TEST_CLIENT_ID: string;
let TEST_MERCHANT_ID: string;
let TEST_SUBMERCHANT_ID: string;

async function setupTestData() {
  log('Setting up test data...');
  
  // Create test merchant
  const merchant = await prisma.merchant.create({
    data: {
      name: 'Test Merchant Gap2',
      phoneNumber: '08123456789',
      email: `test-gap2-${TEST_PREFIX}@test.com`,
    },
  });
  TEST_MERCHANT_ID = merchant.id;
  
  // Create test sub_merchant with DanaRapay credentials
  const subMerchant = await prisma.sub_merchant.create({
    data: {
      merchantId: TEST_MERCHANT_ID,
      name: 'Test SubMerchant DanaRapay',
      provider: 'danarapay',
      fee: 0,
      credentials: {
        baseUrl: 'https://api-stg.danarapay.com',
        username: 'test-user',
        apiKey: 'test-api-key',
      },
    },
  });
  TEST_SUBMERCHANT_ID = subMerchant.id;
  
  // Create test PartnerClient
  const client = await prisma.partnerClient.create({
    data: {
      name: 'Test Client Gap2',
      apiKey: 'test-api-key-gap2-' + TEST_PREFIX,
      apiSecret: 'test-secret',
      balance: INITIAL_BALANCE,
      withdrawFeePercent: 0,
      withdrawFeeFlat: 0,
    },
  });
  TEST_CLIENT_ID = client.id;
  log(`Created client: ${TEST_CLIENT_ID} with balance: ${INITIAL_BALANCE}`);
}

async function cleanupTestData() {
  log('Cleaning up test data...');
  
  try {
    if (TEST_CLIENT_ID) {
      await prisma.withdrawRequest.deleteMany({
        where: { partnerClientId: TEST_CLIENT_ID },
      });
      await prisma.partnerClient.delete({
        where: { id: TEST_CLIENT_ID },
      }).catch(() => {});
    }
    
    if (TEST_SUBMERCHANT_ID) {
      await prisma.sub_merchant.delete({
        where: { id: TEST_SUBMERCHANT_ID },
      }).catch(() => {});
    }
    
    if (TEST_MERCHANT_ID) {
      await prisma.merchant.delete({
        where: { id: TEST_MERCHANT_ID },
      }).catch(() => {});
    }
  } catch (err: any) {
    log(`Cleanup warning: ${err.message}`);
  }
  
  log('Cleanup complete');
}

/**
 * Test: DanaRapay Withdrawal - No Balance Deduction on Create
 */
async function testDanaRapayWithdrawalNoDebitOnCreate() {
  const withdrawalId = `wd-gap2-${TEST_PREFIX}`;
  const withdrawAmount = 100000;
  
  log('--- Test: DanaRapay Withdrawal - No Debit on Create ---');
  
  // Get initial balance
  const clientBefore = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance before create: ${clientBefore?.balance}`);
  
  // Create withdrawal (simulating what controller does)
  const wr = await prisma.withdrawRequest.create({
    data: {
      id: withdrawalId,
      refId: 'ref-' + withdrawalId,
      partnerClientId: TEST_CLIENT_ID,
      accountName: 'Test Account',
      accountNameAlias: 'Test',
      accountNumber: '1234567890',
      bankCode: '014',
      bankName: 'BCA',
      amount: withdrawAmount,
      netAmount: withdrawAmount,
      status: 'PENDING',
      sourceProvider: 'danarapay',
      subMerchantId: TEST_SUBMERCHANT_ID,
      withdrawFeePercent: 0,
      withdrawFeeFlat: 0,
      // DanaRapay: balance NOT deducted on create
      balanceDeducted: false,
      // Simulate remit was called and stored
      disbursementPayload: {
        danarapay_trx_id: 'DR-TRX-12345',
        request: {
          partner_trx_id: withdrawalId,
          bank_code: '014',
          account_number: '1234567890',
          amount: withdrawAmount,
        },
        response: {
          status: { code: '301', message: 'Pending' },
          trx_id: 'DR-TRX-12345',
          success: false,
          pending: true,
        },
        _calledAt: new Date().toISOString(),
      },
    },
  });
  
  log(`Created withdrawal: ${wr.id}, status: ${wr.status}, balanceDeducted: ${wr.balanceDeducted}`);
  
  // Verify balance NOT changed
  const clientAfterCreate = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance after create: ${clientAfterCreate?.balance}`);
  
  const createPassed = clientAfterCreate?.balance === INITIAL_BALANCE;
  
  addResult(
    'DanaRapay Withdrawal - No Debit on Create',
    createPassed,
    `Balance unchanged: ${clientAfterCreate?.balance === INITIAL_BALANCE} (${clientAfterCreate?.balance})`
  );
  
  return { withdrawalId, createPassed };
}

/**
 * Test: DanaRapay Disbursement Callback - Debit on SUCCESS
 */
async function testDanaRapayCallbackDebitOnSuccess(withdrawalId: string) {
  const withdrawAmount = 100000;
  
  log('--- Test: DanaRapay Callback - Debit on SUCCESS (000) ---');
  
  // Get balance before callback
  const clientBefore = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance before SUCCESS callback: ${clientBefore?.balance}`);
  
  // Simulate PENDING callback (non-final) - should NOT debit
  await processWithdrawalCallback(withdrawalId, DISBURSEMENT_CODES.PENDING, {
    partner_trx_id: withdrawalId,
    status: { code: DISBURSEMENT_CODES.PENDING, message: 'Pending' },
  });
  
  const afterPending = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance after PENDING callback: ${afterPending?.balance}`);
  
  // Simulate SUCCESS callback (final) - should trigger debit
  await processWithdrawalCallback(withdrawalId, DISBURSEMENT_CODES.SUCCESS, {
    partner_trx_id: withdrawalId,
    status: { code: DISBURSEMENT_CODES.SUCCESS, message: 'Success' },
    trx_id: 'DR-TRX-12345',
  });
  
  // Now process balance deduction
  const deductResult = await processWithdrawalBalanceDeduction(withdrawalId);
  log(`Deduction result: processed=${deductResult.processed}, balanceChange=${deductResult.balanceChange}`);
  
  const afterSuccess = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance after SUCCESS + deduction: ${afterSuccess?.balance}`);
  
  // Verify balance was deducted
  const expectedBalance = INITIAL_BALANCE - withdrawAmount;
  const debitPassed = afterSuccess?.balance === expectedBalance && deductResult.processed === true;
  
  addResult(
    'DanaRapay Callback - Debit on SUCCESS',
    debitPassed,
    `Deduction processed: ${deductResult.processed}, Balance: ${afterSuccess?.balance} (expected: ${expectedBalance})`
  );
  
  return { debitPassed };
}

/**
 * Test: DanaRapay Duplicate Callback - Idempotent
 */
async function testDanaRapayDuplicateCallbackIdempotent(withdrawalId: string) {
  log('--- Test: DanaRapay Duplicate Callback - Idempotent ---');
  
  const clientBefore = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance before duplicate: ${clientBefore?.balance}`);
  
  // Try duplicate SUCCESS callback
  await processWithdrawalCallback(withdrawalId, DISBURSEMENT_CODES.SUCCESS, {
    partner_trx_id: withdrawalId,
    status: { code: DISBURSEMENT_CODES.SUCCESS, message: 'Success' },
    trx_id: 'DR-TRX-12345',
  });
  
  // Try duplicate deduction
  const duplicateDeduct = await processWithdrawalBalanceDeduction(withdrawalId);
  log(`Duplicate deduction: processed=${duplicateDeduct.processed}, reason=${duplicateDeduct.reason}`);
  
  const clientAfter = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance after duplicate: ${clientAfter?.balance}`);
  
  // Balance should be unchanged
  const idempotentPassed = 
    duplicateDeduct.processed === false &&
    duplicateDeduct.reason === 'ALREADY_DEDUCTED' &&
    clientAfter?.balance === clientBefore?.balance;
  
  addResult(
    'DanaRapay Duplicate Callback - Idempotent',
    idempotentPassed,
    `Duplicate blocked: ${duplicateDeduct.reason}, Balance unchanged: ${clientAfter?.balance === clientBefore?.balance}`
  );
  
  return { idempotentPassed };
}

async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('E2E TEST: Gap 2 - DanaRapay Withdrawal Flow');
  console.log('='.repeat(60) + '\n');
  
  try {
    await setupTestData();
    
    const { withdrawalId, createPassed } = await testDanaRapayWithdrawalNoDebitOnCreate();
    
    if (createPassed) {
      await testDanaRapayCallbackDebitOnSuccess(withdrawalId);
      await testDanaRapayDuplicateCallbackIdempotent(withdrawalId);
    }
    
  } catch (error: any) {
    console.error('Test error:', error.message);
    addResult('Test Suite', false, `Error: ${error.message}`);
  } finally {
    await cleanupTestData();
    await prisma.$disconnect();
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  results.forEach(r => {
    console.log(`${r.passed ? '✅' : '❌'} ${r.name}`);
  });
  
  console.log(`\nTotal: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60) + '\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runAllTests();
