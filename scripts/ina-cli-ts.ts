#!/usr/bin/env node

/**
 * INA Payment & Withdrawal CLI Integration Tool (TypeScript)
 * Direct integration with INA (ING1) provider using API Key & Secret
 *
 * This is a TypeScript version for use in the application
 * Can be compiled to JS or run with ts-node
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import * as crypto from 'crypto';

// ========================================
// TYPES & INTERFACES
// ========================================

interface Config {
  API_KEY: string;
  API_SECRET: string;
  PROVIDER: string;
  API_BASE_URL: string;
  MERCHANT_ID: string;
}

interface ApiResponse {
  success: boolean;
  data?: any;
  error?: string;
}

interface BankInfo {
  code: string;
  name: string;
}

interface PaymentRequest {
  amount: number;
  clientReff: string;
  playerId: string;
  sourceProvider: string;
  merchantId: string;
}

interface WithdrawalValidateRequest {
  account_number: string;
  bank_code: string;
  amount: number;
  sourceProvider: string;
  merchantId: string;
}

interface WithdrawalCreateRequest extends WithdrawalValidateRequest {
  account_name: string;
  bank_name: string;
  otp?: string;
}

// ========================================
// CONFIGURATION
// ========================================

const CONFIG: Config = {
  API_KEY: process.env.INA_API_KEY || '9be3380f-8189-4232-ba1f-78e21ce60948',
  API_SECRET: process.env.INA_API_SECRET || '2af83bbb-e41e-40e1-b10a-3f16c00c858d',
  PROVIDER: process.env.INA_PROVIDER || 'in-1',
  API_BASE_URL: process.env.INA_BASE_URL || 'http://localhost:5000',
  MERCHANT_ID: process.env.INA_MERCHANT_ID || 'test-merchant',
};

// ========================================
// UTILITIES
// ========================================

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const print = {
  header: (text: string) => {
    console.log(`${colors.cyan}${'='.repeat(50)}`);
    console.log(`${text}`);
    console.log(`${'='.repeat(50)}${colors.reset}`);
  },
  subheader: (text: string) => console.log(`${colors.blue}→ ${text}${colors.reset}`),
  success: (text: string) => console.log(`${colors.green}✓ ${text}${colors.reset}`),
  error: (text: string) => console.log(`${colors.red}✗ ${text}${colors.reset}`),
  info: (text: string) => console.log(`${colors.blue}ℹ ${text}${colors.reset}`),
  warning: (text: string) => console.log(`${colors.yellow}⚠ ${text}${colors.reset}`),
  json: (obj: any, title?: string) => {
    if (title) console.log(`${colors.blue}${title}:${colors.reset}`);
    console.log(JSON.stringify(obj, null, 2));
  },
  table: (data: any, title?: string) => {
    if (title) console.log(`${colors.blue}${title}:${colors.reset}`);
    console.table(data);
  },
};

// Generate signature for API requests
const generateSignature = (method: string, path: string, timestamp: string, body: string = ''): string => {
  const message = `${method}${path}${timestamp}${body}`;
  return crypto
    .createHmac('sha256', CONFIG.API_SECRET)
    .update(message)
    .digest('hex');
};

// Make HTTP/HTTPS request
const makeRequest = (url: string, options: any, data: any = null): Promise<any> => {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = client.request(reqOptions, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body,
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }

    req.end();
  });
};

// Make API request with authentication
const makeApiRequest = async (method: string, path: string, data: any = null): Promise<ApiResponse> => {
  const timestamp = Date.now().toString();
  const bodyString = data ? JSON.stringify(data) : '';
  const signature = generateSignature(method, path, timestamp, bodyString);

  const url = `${CONFIG.API_BASE_URL}${path}`;

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': CONFIG.API_KEY,
    'X-Signature': signature,
    'X-Timestamp': timestamp,
  };

  try {
    const response = await makeRequest(url, {
      method,
      headers,
    }, data);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return {
        success: true,
        data: response.body,
      };
    } else {
      return {
        success: false,
        error: response.body?.message || `HTTP ${response.statusCode}`,
        data: response.body,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};

// Bank configuration
const bankMap: Record<string, BankInfo> = {
  bca: { code: '014', name: 'Bank Central Asia' },
  mandiri: { code: '008', name: 'Bank Mandiri' },
  bni: { code: '009', name: 'Bank Negara Indonesia' },
  bri: { code: '002', name: 'Bank Rakyat Indonesia' },
  permata: { code: '013', name: 'Bank Permata' },
  cimb: { code: '022', name: 'Bank CIMB Niaga' },
  '014': { code: '014', name: 'Bank Central Asia' },
  '008': { code: '008', name: 'Bank Mandiri' },
  '009': { code: '009', name: 'Bank Negara Indonesia' },
  '002': { code: '002', name: 'Bank Rakyat Indonesia' },
  '013': { code: '013', name: 'Bank Permata' },
  '022': { code: '022', name: 'Bank CIMB Niaga' },
};

const getBankInfo = (input: string): BankInfo => {
  const key = input.toLowerCase();
  return bankMap[key] || { code: input, name: 'Unknown Bank' };
};

// ========================================
// PAYMENT OPERATIONS CLASS
// ========================================

class PaymentOps {
  async create(amount: string, playerId?: string) {
    print.header('Creating Payment Request');

    const clientReff = `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    print.info(`Client Reference: ${clientReff}`);
    print.info(`Amount: ${amount}`);
    print.info(`Player ID: ${playerId || 'N/A'}`);

    const payload: PaymentRequest = {
      amount: parseInt(amount),
      clientReff,
      playerId: playerId || `player_${Date.now()}`,
      sourceProvider: CONFIG.PROVIDER,
      merchantId: CONFIG.MERCHANT_ID,
    };

    print.subheader('Sending request to API...');
    const result = await makeApiRequest('POST', '/api/v1/payments', payload);

    if (result.success) {
      print.success('Payment request created successfully!');
      print.json(result.data);
    } else {
      print.error(`Failed to create payment: ${result.error}`);
      if (result.data) print.json(result.data);
    }
  }

  async check(orderId: string) {
    print.header('Checking Payment Status');
    print.info(`Order ID: ${orderId}`);

    print.subheader('Fetching status...');
    const result = await makeApiRequest('GET', `/api/v1/orders/${orderId}`);

    if (result.success) {
      print.success('Payment status retrieved!');
      const data = result.data;
      print.table({
        'Order ID': data.id || orderId,
        'Status': data.status,
        'Amount': data.amount,
        'Provider': data.provider,
        'Created': data.createdAt,
        'Updated': data.updatedAt,
      }, 'Payment Details');
      if (data.checkoutUrl) print.info(`Checkout URL: ${data.checkoutUrl}`);
      if (data.qrPayload) print.info(`QR Payload: ${data.qrPayload.substring(0, 50)}...`);
    } else {
      print.error(`Failed to check payment: ${result.error}`);
      if (result.data) print.json(result.data);
    }
  }

  async history(page: string = '1', limit: string = '20') {
    print.header('Payment History');
    print.info(`Page: ${page}, Limit: ${limit}`);

    print.subheader('Fetching history...');
    const result = await makeApiRequest('GET', `/api/v1/payments?page=${page}&limit=${limit}`);

    if (result.success) {
      const data = result.data;
      print.success(`Retrieved ${data.data?.length || 0} payments`);

      if (data.data && Array.isArray(data.data)) {
        const summary = data.data.map((p: any) => ({
          'ID': p.id,
          'Amount': p.amount,
          'Status': p.status,
          'Provider': p.provider,
          'Created': new Date(p.createdAt).toLocaleString(),
        }));
        print.table(summary);
        print.info(`Total: ${data.total || 'Unknown'}`);
      }
    } else {
      print.error(`Failed to fetch history: ${result.error}`);
      if (result.data) print.json(result.data);
    }
  }
}

// ========================================
// WITHDRAWAL OPERATIONS CLASS
// ========================================

class WithdrawalOps {
  async validate(account: string, bank: string, amount: string) {
    print.header('Validating Bank Account');

    const bankInfo = getBankInfo(bank);
    print.info(`Account: ${account}`);
    print.info(`Bank: ${bankInfo.name} (${bankInfo.code})`);
    print.info(`Amount: ${amount}`);

    const payload: WithdrawalValidateRequest = {
      account_number: account,
      bank_code: bankInfo.code,
      amount: parseInt(amount),
      sourceProvider: CONFIG.PROVIDER,
      merchantId: CONFIG.MERCHANT_ID,
    };

    print.subheader('Validating account...');
    const result = await makeApiRequest('POST', '/api/v1/client/withdrawals/validate', payload);

    if (result.success) {
      const data = result.data;
      print.success('Account validation successful!');
      print.table({
        'Account Number': data.account_number,
        'Account Name': data.account_name,
        'Bank': data.bank_name,
        'Bank Code': data.bank_code,
        'Status': data.status,
        'Fee': data.fee,
      }, 'Account Details');
    } else {
      print.error(`Validation failed: ${result.error}`);
      if (result.data) print.json(result.data);
    }
  }

  async create(account: string, bank: string, amount: string) {
    print.header('Creating Withdrawal Request');

    const bankInfo = getBankInfo(bank);
    print.info(`Account: ${account}`);
    print.info(`Bank: ${bankInfo.name} (${bankInfo.code})`);
    print.info(`Amount: ${amount}`);

    // First validate the account
    print.subheader('Step 1: Validating account...');
    const validatePayload: WithdrawalValidateRequest = {
      account_number: account,
      bank_code: bankInfo.code,
      amount: parseInt(amount),
      sourceProvider: CONFIG.PROVIDER,
      merchantId: CONFIG.MERCHANT_ID,
    };

    const validateResult = await makeApiRequest('POST', '/api/v1/client/withdrawals/validate', validatePayload);

    if (!validateResult.success) {
      print.error(`Account validation failed: ${validateResult.error}`);
      return;
    }

    const accountData = validateResult.data;
    print.success('Account validated!');

    // Create withdrawal request
    print.subheader('Step 2: Creating withdrawal...');
    const withdrawalPayload: WithdrawalCreateRequest = {
      account_number: account,
      bank_code: bankInfo.code,
      amount: parseInt(amount),
      account_name: accountData.account_name || '',
      bank_name: accountData.bank_name || bankInfo.name,
      sourceProvider: CONFIG.PROVIDER,
      merchantId: CONFIG.MERCHANT_ID,
      otp: process.env.INA_OTP || '',
    };

    const result = await makeApiRequest('POST', '/api/v1/client/withdrawals', withdrawalPayload);

    if (result.success) {
      const data = result.data;
      print.success('Withdrawal request created successfully!');
      print.table({
        'Withdrawal ID': data.id,
        'Reference ID': data.refId,
        'Amount': data.amount,
        'Status': data.status,
        'Fee': data.fee,
        'Net Amount': data.netAmount,
        'Created': new Date(data.createdAt).toLocaleString(),
      }, 'Withdrawal Details');
    } else {
      print.error(`Failed to create withdrawal: ${result.error}`);
      if (result.data) print.json(result.data);
    }
  }

  async check(withdrawalId: string) {
    print.header('Checking Withdrawal Status');
    print.info(`Withdrawal ID: ${withdrawalId}`);

    print.subheader('Fetching status...');
    const result = await makeApiRequest('GET', `/api/v1/client/withdrawals/${withdrawalId}`);

    if (result.success) {
      const data = result.data;
      print.success('Withdrawal status retrieved!');
      print.table({
        'Reference ID': data.refId,
        'Status': data.status,
        'Amount': data.amount,
        'Net Amount': data.netAmount,
        'Fee': data.fee,
        'Bank': data.bank_name,
        'Account': data.account_number,
        'Created': new Date(data.createdAt).toLocaleString(),
        'Completed': data.completedAt ? new Date(data.completedAt).toLocaleString() : 'Pending',
      }, 'Withdrawal Details');
    } else {
      print.error(`Failed to check withdrawal: ${result.error}`);
      if (result.data) print.json(result.data);
    }
  }

  async history(page: string = '1', limit: string = '20', status?: string) {
    print.header('Withdrawal History');
    print.info(`Page: ${page}, Limit: ${limit}${status ? `, Status: ${status}` : ''}`);

    print.subheader('Fetching history...');
    let query = `/api/v1/client/withdrawals?page=${page}&limit=${limit}`;
    if (status) query += `&status=${status}`;

    const result = await makeApiRequest('GET', query);

    if (result.success) {
      const data = result.data;
      print.success(`Retrieved ${data.data?.length || 0} withdrawals`);

      if (data.data && Array.isArray(data.data)) {
        const summary = data.data.map((w: any) => ({
          'ID': w.id,
          'Ref ID': w.refId,
          'Amount': w.amount,
          'Net': w.netAmount,
          'Fee': w.fee,
          'Status': w.status,
          'Bank': w.bank_name,
          'Account': w.account_number.slice(-4),
          'Created': new Date(w.createdAt).toLocaleString(),
        }));
        print.table(summary);
        print.info(`Total: ${data.total || 'Unknown'}`);
      }
    } else {
      print.error(`Failed to fetch history: ${result.error}`);
      if (result.data) print.json(result.data);
    }
  }

  banks() {
    print.header('Supported Banks');
    const banks = Object.values(bankMap).reduce((acc: BankInfo[], bank: BankInfo) => {
      if (!acc.some(b => b.code === bank.code)) {
        acc.push(bank);
      }
      return acc;
    }, []);

    const summary = banks.map(b => ({
      'Code': b.code,
      'Bank Name': b.name,
    }));

    print.table(summary);
  }
}

// ========================================
// MAIN FUNCTION
// ========================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp();
    return;
  }

  const [operation, command, ...params] = args;

  try {
    const paymentOps = new PaymentOps();
    const withdrawalOps = new WithdrawalOps();

    if (operation === 'payment') {
      switch (command) {
        case 'create':
          if (!params[0]) {
            print.error('Amount is required: node ina-cli-ts.ts payment create <amount> [playerId]');
            return;
          }
          await paymentOps.create(params[0], params[1]);
          break;

        case 'check':
          if (!params[0]) {
            print.error('Order ID is required: node ina-cli-ts.ts payment check <orderId>');
            return;
          }
          await paymentOps.check(params[0]);
          break;

        case 'history':
          await paymentOps.history(params[0] || '1', params[1] || '20');
          break;

        default:
          print.error(`Unknown payment command: ${command}`);
          showHelp();
      }
    } else if (operation === 'withdraw') {
      switch (command) {
        case 'validate':
          if (!params[0] || !params[1] || !params[2]) {
            print.error('Required: node ina-cli-ts.ts withdraw validate <account> <bank> <amount>');
            return;
          }
          await withdrawalOps.validate(params[0], params[1], params[2]);
          break;

        case 'create':
          if (!params[0] || !params[1] || !params[2]) {
            print.error('Required: node ina-cli-ts.ts withdraw create <account> <bank> <amount>');
            return;
          }
          await withdrawalOps.create(params[0], params[1], params[2]);
          break;

        case 'check':
          if (!params[0]) {
            print.error('Withdrawal ID is required: node ina-cli-ts.ts withdraw check <withdrawalId>');
            return;
          }
          await withdrawalOps.check(params[0]);
          break;

        case 'history':
          await withdrawalOps.history(params[0] || '1', params[1] || '20', params[2]);
          break;

        case 'banks':
          withdrawalOps.banks();
          break;

        default:
          print.error(`Unknown withdrawal command: ${command}`);
          showHelp();
      }
    } else {
      print.error(`Unknown operation: ${operation}`);
      showHelp();
    }
  } catch (error: any) {
    print.error(`Error: ${error.message}`);
    console.error(error);
  }
}

function showHelp() {
  console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════════════╗
║          INA Payment & Withdrawal CLI Integration Tool          ║
╚════════════════════════════════════════════════════════════════╝${colors.reset}

${colors.blue}PAYMENT OPERATIONS:${colors.reset}
  node ina-cli-ts.ts payment create <amount> [playerId]
    → Create a new payment request
    Example: node ina-cli-ts.ts payment create 50000 player_123

  node ina-cli-ts.ts payment check <orderId>
    → Check payment status
    Example: node ina-cli-ts.ts payment check order_xyz123

  node ina-cli-ts.ts payment history [page] [limit]
    → Get payment history (default: page 1, limit 20)
    Example: node ina-cli-ts.ts payment history 1 10

${colors.blue}WITHDRAWAL OPERATIONS:${colors.reset}
  node ina-cli-ts.ts withdraw validate <account> <bank> <amount>
    → Validate bank account before withdrawal
    Example: node ina-cli-ts.ts withdraw validate 1234567890 bca 50000

  node ina-cli-ts.ts withdraw create <account> <bank> <amount>
    → Create withdrawal request
    Example: node ina-cli-ts.ts withdraw create 1234567890 bca 50000

  node ina-cli-ts.ts withdraw check <withdrawalId>
    → Check withdrawal status
    Example: node ina-cli-ts.ts withdraw check withdraw_xyz123

  node ina-cli-ts.ts withdraw history [page] [limit] [status]
    → Get withdrawal history (default: page 1, limit 20)
    Example: node ina-cli-ts.ts withdraw history 1 10 PENDING

  node ina-cli-ts.ts withdraw banks
    → List all supported banks

${colors.blue}SUPPORTED BANKS:${colors.reset}
  • bca / 014  → Bank Central Asia
  • mandiri / 008 → Bank Mandiri
  • bni / 009  → Bank Negara Indonesia
  • bri / 002  → Bank Rakyat Indonesia
  • permata / 013 → Bank Permata
  • cimb / 022 → Bank CIMB Niaga

${colors.blue}ENVIRONMENT VARIABLES:${colors.reset}
  INA_API_KEY       → API Key (default: configured)
  INA_API_SECRET    → API Secret (default: configured)
  INA_BASE_URL      → API Base URL (default: http://localhost:5000)
  INA_PROVIDER      → Provider name (default: in-1)
  INA_MERCHANT_ID   → Merchant ID (default: test-merchant)
  INA_OTP           → OTP for withdrawal (if required)

${colors.blue}EXAMPLES:${colors.reset}

  # Create payment of 50,000 IDR
  node ina-cli-ts.ts payment create 50000

  # Check payment status
  node ina-cli-ts.ts payment check order_abc123

  # Validate bank account (BCA)
  node ina-cli-ts.ts withdraw validate 1234567890 014 100000

  # Create withdrawal
  node ina-cli-ts.ts withdraw create 1234567890 bca 50000

  # Check withdrawal status
  node ina-cli-ts.ts withdraw check withdrawal_xyz123

  # View withdrawal history
  node ina-cli-ts.ts withdraw history 1 20

  # List supported banks
  node ina-cli-ts.ts withdraw banks

${colors.yellow}Configuration:${colors.reset}
  API Key: ${CONFIG.API_KEY}
  Provider: ${CONFIG.PROVIDER}
  Base URL: ${CONFIG.API_BASE_URL}
  Merchant ID: ${CONFIG.MERCHANT_ID}
  `);
}

// Run main
main().catch((error) => {
  print.error(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

export { PaymentOps, WithdrawalOps, makeApiRequest, CONFIG };
