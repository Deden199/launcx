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

  return prisma;
};

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const prisma = globalForPrisma.prisma ?? instantiatePrisma();
globalForPrisma.prisma = prisma;

export const disconnectPrisma = async () => {
  try {
    await prisma.$disconnect();
    console.log('Prisma disconnected successfully');
  } catch (error) {
    console.error('Error disconnecting Prisma:', error);
  }
};

export { Prisma };

export { prisma };
