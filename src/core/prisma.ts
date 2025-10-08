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

export const prisma =
  globalForPrisma.prisma ?? instantiatePrisma();

// Export Prisma namespace for raw queries
export { Prisma };

// Prevent multiple instances in development for hot-reloading
if (config.nodeEnv !== 'production') {
  globalForPrisma.prisma = prisma;
}
