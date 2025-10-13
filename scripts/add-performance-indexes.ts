/**
 * Script to add performance indexes for MongoDB
 * Run with: npx ts-node scripts/add-performance-indexes.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function addPerformanceIndexes() {
  console.log('Adding performance indexes...')
  console.log('Connecting to MongoDB...')

  try {
    // Connect to MongoDB using Prisma's raw connection
    await prisma.$connect()

    // Use Prisma's $runCommandRaw to create indexes
    console.log('\nCreating compound indexes for Order collection...')

    // Index 1: For listSubMerchants query
    // Covers: subMerchantId + partnerClientId + settlementTime queries
    try {
      await prisma.$runCommandRaw({
        createIndexes: 'Order',
        indexes: [
          {
            key: { subMerchantId: 1, partnerClientId: 1, settlementTime: 1 },
            name: 'idx_submerchant_partner_settlement',
            background: true
          }
        ]
      })
      console.log('  ✓ Created index: idx_submerchant_partner_settlement')
    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        console.log('  ⚠ Index already exists: idx_submerchant_partner_settlement')
      } else {
        throw err
      }
    }

    // Index 2: For dashboard queries with status filtering
    // Covers: partnerClientId + status + createdAt queries
    try {
      await prisma.$runCommandRaw({
        createIndexes: 'Order',
        indexes: [
          {
            key: { partnerClientId: 1, status: 1, createdAt: -1 },
            name: 'idx_partner_status_created',
            background: true
          }
        ]
      })
      console.log('  ✓ Created index: idx_partner_status_created')
    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        console.log('  ⚠ Index already exists: idx_partner_status_created')
      } else {
        throw err
      }
    }

    // Index 3: For groupBy operations on subMerchant queries
    try {
      await prisma.$runCommandRaw({
        createIndexes: 'Order',
        indexes: [
          {
            key: { subMerchantId: 1, status: 1, settlementTime: 1 },
            name: 'idx_submerchant_status_settlement',
            background: true
          }
        ]
      })
      console.log('  ✓ Created index: idx_submerchant_status_settlement')
    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        console.log('  ⚠ Index already exists: idx_submerchant_status_settlement')
      } else {
        throw err
      }
    }

    // Index 4: For aggregate queries with date filtering
    try {
      await prisma.$runCommandRaw({
        createIndexes: 'Order',
        indexes: [
          {
            key: { partnerClientId: 1, createdAt: -1, status: 1, settlementAmount: 1 },
            name: 'idx_partner_created_status_amount',
            background: true
          }
        ]
      })
      console.log('  ✓ Created index: idx_partner_created_status_amount')
    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        console.log('  ⚠ Index already exists: idx_partner_created_status_amount')
      } else {
        throw err
      }
    }

    // Index 5: For withdrawal balance calculations
    console.log('\nCreating compound indexes for WithdrawRequest collection...')
    try {
      await prisma.$runCommandRaw({
        createIndexes: 'WithdrawRequest',
        indexes: [
          {
            key: { subMerchantId: 1, partnerClientId: 1, status: 1 },
            name: 'idx_submerchant_partner_status',
            background: true
          }
        ]
      })
      console.log('  ✓ Created index: idx_submerchant_partner_status on WithdrawRequest')
    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        console.log('  ⚠ Index already exists: idx_submerchant_partner_status')
      } else {
        throw err
      }
    }

    console.log('\n✅ All performance indexes created successfully!')
    console.log('\nNote: Indexes are being built in the background.')
    console.log('Check index build progress with: db.currentOp({"command.createIndexes": {$exists:true}})')
  } catch (error) {
    console.error('❌ Error creating indexes:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
addPerformanceIndexes()
  .then(() => {
    console.log('\n✨ Index creation complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Index creation failed:', error)
    process.exit(1)
  })