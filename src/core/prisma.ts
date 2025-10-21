import { PrismaClient, Prisma } from '@prisma/client';
import { config } from '../config';

// This is a helper function that instantiates Prisma
const instantiatePrisma = () => {
  const prisma = new PrismaClient({
    log: config.nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
    // Connection pool settings for high-load production environments
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  prisma.$on('beforeExit', async () => {
    console.log('Read-only Prisma client is shutting down gracefully...');
  });

  return prisma;
};

// Read-only Prisma client for secondary preferred reads
const instantiatePrismaReadOnly = () => {
  // Get the base DATABASE_URL and add readPreference=secondaryPreferred
  const baseUrl = process.env.DATABASE_URL || '';
  const separator = baseUrl.includes('?') ? '&' : '?';
  const readOnlyUrl = `${baseUrl}${separator}readPreference=secondaryPreferred`;
  
  const prismaReadOnly = new PrismaClient({
    log: config.nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: readOnlyUrl,
      },
    },
    // Optimized for read operations
    // engineType: 'binary',
    errorFormat: 'pretty',
  });

  // Add connection monitoring for read-only client
  prismaReadOnly.$on('beforeExit', async () => {
    console.log('Read-only Prisma client is shutting down gracefully...');
  });

  return prismaReadOnly;
};

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaReadOnly?: PrismaClient;
};

const prisma = globalForPrisma.prisma ?? instantiatePrisma();
globalForPrisma.prisma = prisma;

const prismaReadOnly = globalForPrisma.prismaReadOnly ?? instantiatePrismaReadOnly();
globalForPrisma.prismaReadOnly = prismaReadOnly;

export const disconnectPrisma = async () => {
  try {
    await prisma.$disconnect();
    console.log('Prisma disconnected successfully');
  } catch (error) {
    console.error('Error disconnecting Prisma:', error);
  }

  try {
    await prismaReadOnly.$disconnect();
    console.log('Read-only Prisma disconnected successfully');
  } catch (error) {
    console.error('Error disconnecting Prisma:', error);
  }
};

export { Prisma };

export { prisma, prismaReadOnly };
