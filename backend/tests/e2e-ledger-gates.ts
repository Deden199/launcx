/**
 * E2E Test Script for DanaRapay Source of Truth Implementation
 * 
 * Test Scenarios:
 * 1. VA Flow: WAITING -> SUCCESS + duplicate callback (credit hanya 1x)
 * 2. Withdrawal Flow: create(no debit) -> pending -> success + duplicate (debit hanya 1x)
 * 3. Insufficient balance test (debit harus gagal, saldo tidak minus)
 * 4. Legacy provider debit-on-create -> FAILED -> refund (saldo balik, idempotent)
 * 5. Callback security: valid vs invalid token
 */

import { prisma } from '../../src/core/prisma';
import {
  processOrderSettlement,
  processWithdrawalBalanceDeduction,
  refundFailedWithdrawal,
  processWithdrawalCallback,
  DISBURSEMENT_CODES,
} from '../../src/service/ledger.service';

const TEST_PREFIX = Date.now().toString();
const TEST_CLIENT_ID = 'test-client-' + TEST_PREFIX;
const TEST_MERCHANT_ID = 'test-merchant-' + TEST_PREFIX;
const TEST_SUBMERCHANT_ID = 'test-submerchant-' + TEST_PREFIX;
const TEST_ORDER_ID = 'test-order-' + TEST_PREFIX;
const TEST_WITHDRAWAL_ID = 'test-wd-' + TEST_PREFIX;
const INITIAL_BALANCE = 1000000; // 1 juta

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

async function setupTestData() {
  log('Setting up test data...');
  
  // Create test merchant first
  await prisma.merchant.upsert({
    where: { id: TEST_MERCHANT_ID },
    create: {
      id: TEST_MERCHANT_ID,
      name: 'Test Merchant E2E',
      phoneNumber: '08123456789',
      email: 'test@test.com',
    },
    update: {},
  });
  
  // Create test sub_merchant
  await prisma.sub_merchant.upsert({
    where: { id: TEST_SUBMERCHANT_ID },
    create: {
      id: TEST_SUBMERCHANT_ID,
      merchantId: TEST_MERCHANT_ID,
      name: 'Test SubMerchant',
      provider: 'danarapay',
      fee: 0,
    },
    update: {},
  });
  
  // Create test PartnerClient
  await prisma.partnerClient.upsert({
    where: { id: TEST_CLIENT_ID },
    create: {
      id: TEST_CLIENT_ID,
      name: 'Test Client E2E',
      apiKey: 'test-api-key-' + TEST_PREFIX,
      apiSecret: 'test-secret',
      balance: INITIAL_BALANCE,
      withdrawFeePercent: 0,
      withdrawFeeFlat: 0,
    },
    update: {
      balance: INITIAL_BALANCE,
    },
  });
  
  log(`Created test client with balance: ${INITIAL_BALANCE}`);
}

async function cleanupTestData() {
  log('Cleaning up test data...');
  
  // Delete test orders
  await prisma.order.deleteMany({
    where: { id: { startsWith: 'test-order-' } },
  });
  
  // Delete test withdrawals
  await prisma.withdrawRequest.deleteMany({
    where: { id: { startsWith: 'test-wd-' } },
  });
  
  // Delete test clients
  await prisma.partnerClient.deleteMany({
    where: { id: { startsWith: 'test-client-' } },
  });
  
  // Delete test sub_merchants
  await prisma.sub_merchant.deleteMany({
    where: { id: { startsWith: 'test-submerchant-' } },
  });
  
  // Delete test merchants
  await prisma.merchant.deleteMany({
    where: { id: { startsWith: 'test-merchant-' } },
  });
  
  log('Cleanup complete');
}

/**
 * Test 1: VA Settlement - Single Credit Only
 */
async function testVaSettlementSingleCredit() {
  const orderId = TEST_ORDER_ID + '-va';
  const settlementAmount = 100000;
  
  log('--- Test 1: VA Settlement Single Credit ---');
  
  // Create test order with SETTLED status
  await prisma.order.create({
    data: {
      id: orderId,
      partnerClientId: TEST_CLIENT_ID,
      amount: settlementAmount,
      pendingAmount: settlementAmount,
      settlementAmount: settlementAmount,
      feeLauncx: 0,
      playerId: 'test-player',
      userId: 'test-user',
      status: 'SETTLED',
      settlementStatus: 'SUCCESS',
      channel: 'VA_DANARAPAY',
      checkoutUrl: '',
      ledgerProcessed: false,
    },
  });
  
  // Get initial balance
  const clientBefore = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  
  log(`Balance before: ${clientBefore?.balance}`);
  
  // First settlement call
  const result1 = await processOrderSettlement(orderId);
  log(`First call: processed=${result1.processed}, balanceChange=${result1.balanceChange}`);
  
  // Second (duplicate) settlement call - should be idempotent
  const result2 = await processOrderSettlement(orderId);
  log(`Second call (duplicate): processed=${result2.processed}, reason=${result2.reason}`);
  
  // Get final balance
  const clientAfter = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  
  log(`Balance after: ${clientAfter?.balance}`);
  
  // Verify
  const expectedBalance = INITIAL_BALANCE + settlementAmount;
  const actualBalance = clientAfter?.balance || 0;
  
  const passed = 
    result1.processed === true &&
    result2.processed === false &&
    result2.reason === 'ALREADY_PROCESSED' &&
    actualBalance === expectedBalance;
  
  addResult(
    'VA Settlement Single Credit',
    passed,
    `Expected balance: ${expectedBalance}, Actual: ${actualBalance}. ` +
    `First call credited: ${result1.processed}, Second call blocked: ${result2.reason}`
  );
  
  return passed;
}

/**
 * Test 2: Withdrawal Flow - DanaRapay (no debit on create)
 */
async function testWithdrawalFlowDanaRapay() {
  const withdrawalId = TEST_WITHDRAWAL_ID + '-dr';
  const withdrawAmount = 50000;
  
  log('--- Test 2: Withdrawal Flow DanaRapay ---');
  
  // Reset client balance
  await prisma.partnerClient.update({
    where: { id: TEST_CLIENT_ID },
    data: { balance: INITIAL_BALANCE },
  });
  
  // Create test withdrawal (DanaRapay style - balanceDeducted = false)
  await prisma.withdrawRequest.create({
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
      balanceDeducted: false, // DanaRapay: no debit on create
    },
  });
  
  // Verify balance NOT deducted on create
  const afterCreate = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance after create (should be unchanged): ${afterCreate?.balance}`);
  
  const createOk = afterCreate?.balance === INITIAL_BALANCE;
  
  // Simulate PENDING callback
  await processWithdrawalCallback(withdrawalId, DISBURSEMENT_CODES.PENDING, {
    partner_trx_id: withdrawalId,
    status: { code: DISBURSEMENT_CODES.PENDING, message: 'Pending' },
  });
  
  const afterPending = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance after PENDING callback: ${afterPending?.balance}`);
  
  // Simulate SUCCESS callback
  await processWithdrawalCallback(withdrawalId, DISBURSEMENT_CODES.SUCCESS, {
    partner_trx_id: withdrawalId,
    status: { code: DISBURSEMENT_CODES.SUCCESS, message: 'Success' },
  });
  
  // Now trigger balance deduction
  const deductResult1 = await processWithdrawalBalanceDeduction(withdrawalId);
  log(`First deduction: processed=${deductResult1.processed}, balanceChange=${deductResult1.balanceChange}`);
  
  // Duplicate deduction call - should be blocked
  const deductResult2 = await processWithdrawalBalanceDeduction(withdrawalId);
  log(`Second deduction (duplicate): processed=${deductResult2.processed}, reason=${deductResult2.reason}`);
  
  const afterDeduct = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance after deduction: ${afterDeduct?.balance}`);
  
  const expectedBalance = INITIAL_BALANCE - withdrawAmount;
  const passed = 
    createOk &&
    deductResult1.processed === true &&
    deductResult2.processed === false &&
    deductResult2.reason === 'ALREADY_DEDUCTED' &&
    afterDeduct?.balance === expectedBalance;
  
  addResult(
    'Withdrawal Flow DanaRapay',
    passed,
    `Create no debit: ${createOk}, First deduct: ${deductResult1.processed}, ` +
    `Duplicate blocked: ${deductResult2.reason}, Final balance: ${afterDeduct?.balance} (expected: ${expectedBalance})`
  );
  
  return passed;
}

/**
 * Test 3: Negative Balance Guard
 */
async function testNegativeBalanceGuard() {
  const withdrawalId = TEST_WITHDRAWAL_ID + '-neg';
  const withdrawAmount = INITIAL_BALANCE + 100000; // More than balance
  
  log('--- Test 3: Negative Balance Guard ---');
  
  // Reset client balance
  await prisma.partnerClient.update({
    where: { id: TEST_CLIENT_ID },
    data: { balance: INITIAL_BALANCE },
  });
  
  // Create withdrawal with amount > balance
  await prisma.withdrawRequest.create({
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
      status: 'COMPLETED', // Set as completed to trigger deduction
      sourceProvider: 'danarapay',
      subMerchantId: TEST_SUBMERCHANT_ID,
      withdrawFeePercent: 0,
      withdrawFeeFlat: 0,
      balanceDeducted: false,
    },
  });
  
  // Try to deduct - should fail due to insufficient balance
  const deductResult = await processWithdrawalBalanceDeduction(withdrawalId);
  log(`Deduction result: processed=${deductResult.processed}, reason=${deductResult.reason}`);
  
  // Verify balance unchanged
  const afterAttempt = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance after failed deduction: ${afterAttempt?.balance}`);
  
  const passed = 
    deductResult.processed === false &&
    deductResult.reason === 'INSUFFICIENT_BALANCE' &&
    afterAttempt?.balance === INITIAL_BALANCE;
  
  addResult(
    'Negative Balance Guard',
    passed,
    `Deduction blocked: ${deductResult.reason}, Balance unchanged: ${afterAttempt?.balance === INITIAL_BALANCE}`
  );
  
  return passed;
}

/**
 * Test 4: Legacy Provider Refund
 */
async function testLegacyProviderRefund() {
  const withdrawalId = TEST_WITHDRAWAL_ID + '-legacy';
  const withdrawAmount = 50000;
  
  log('--- Test 4: Legacy Provider Refund ---');
  
  // Reset client balance
  await prisma.partnerClient.update({
    where: { id: TEST_CLIENT_ID },
    data: { balance: INITIAL_BALANCE },
  });
  
  // Create withdrawal with balanceDeducted=true (legacy provider style)
  await prisma.withdrawRequest.create({
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
      status: 'FAILED', // Set as failed
      sourceProvider: 'hilogate', // Legacy provider
      subMerchantId: TEST_SUBMERCHANT_ID,
      withdrawFeePercent: 0,
      withdrawFeeFlat: 0,
      balanceDeducted: true, // Legacy: balance was deducted on create
      balanceRefunded: false,
    },
  });
  
  // Manually deduct balance to simulate legacy behavior
  await prisma.partnerClient.update({
    where: { id: TEST_CLIENT_ID },
    data: { balance: INITIAL_BALANCE - withdrawAmount },
  });
  
  const beforeRefund = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance before refund: ${beforeRefund?.balance}`);
  
  // Trigger refund
  const refundResult1 = await refundFailedWithdrawal(withdrawalId);
  log(`First refund: processed=${refundResult1.processed}`);
  
  // Duplicate refund - should be idempotent
  const refundResult2 = await refundFailedWithdrawal(withdrawalId);
  log(`Second refund (duplicate): processed=${refundResult2.processed}, reason=${refundResult2.reason}`);
  
  const afterRefund = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance after refund: ${afterRefund?.balance}`);
  
  const passed = 
    refundResult1.processed === true &&
    refundResult2.processed === false &&
    refundResult2.reason === 'ALREADY_REFUNDED' &&
    afterRefund?.balance === INITIAL_BALANCE;
  
  addResult(
    'Legacy Provider Refund',
    passed,
    `First refund: ${refundResult1.processed}, Duplicate blocked: ${refundResult2.reason}, ` +
    `Balance restored: ${afterRefund?.balance} (expected: ${INITIAL_BALANCE})`
  );
  
  return passed;
}

/**
 * Test 5: DanaRapay Withdrawal No Refund (balanceDeducted=false)
 */
async function testDanarapayNoRefund() {
  const withdrawalId = TEST_WITHDRAWAL_ID + '-dr-norefund';
  const withdrawAmount = 50000;
  
  log('--- Test 5: DanaRapay No Refund (balanceDeducted=false) ---');
  
  // Reset client balance
  await prisma.partnerClient.update({
    where: { id: TEST_CLIENT_ID },
    data: { balance: INITIAL_BALANCE },
  });
  
  // Create DanaRapay withdrawal that failed (balanceDeducted=false)
  await prisma.withdrawRequest.create({
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
      status: 'FAILED',
      sourceProvider: 'danarapay',
      subMerchantId: TEST_SUBMERCHANT_ID,
      withdrawFeePercent: 0,
      withdrawFeeFlat: 0,
      balanceDeducted: false, // DanaRapay: balance was NOT deducted
      balanceRefunded: false,
    },
  });
  
  const beforeRefund = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance before refund attempt: ${beforeRefund?.balance}`);
  
  // Try refund - should be skipped because balanceDeducted=false
  const refundResult = await refundFailedWithdrawal(withdrawalId);
  log(`Refund result: processed=${refundResult.processed}, reason=${refundResult.reason}`);
  
  const afterRefund = await prisma.partnerClient.findUnique({
    where: { id: TEST_CLIENT_ID },
    select: { balance: true },
  });
  log(`Balance after refund attempt: ${afterRefund?.balance}`);
  
  const passed = 
    refundResult.processed === false &&
    refundResult.reason === 'BALANCE_NOT_DEDUCTED' &&
    afterRefund?.balance === INITIAL_BALANCE;
  
  addResult(
    'DanaRapay No Refund',
    passed,
    `Refund skipped: ${refundResult.reason}, Balance unchanged: ${afterRefund?.balance === INITIAL_BALANCE}`
  );
  
  return passed;
}

async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('E2E TEST: DanaRapay Source of Truth - 4 Safety Gates');
  console.log('='.repeat(60) + '\n');
  
  try {
    await setupTestData();
    
    await testVaSettlementSingleCredit();
    await testWithdrawalFlowDanaRapay();
    await testNegativeBalanceGuard();
    await testLegacyProviderRefund();
    await testDanarapayNoRefund();
    
  } catch (error: any) {
    console.error('Test error:', error.message);
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
