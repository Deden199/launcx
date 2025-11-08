import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const password = '@Bogor123';
  const hash     = await bcrypt.hash(password, 10);

  await prisma.partnerUser.upsert({
    where: { email: 'admin123@launcx.com' },
    update: { password: hash, role: 'ADMIN' },
    create: {
      name:     'Admin Launcx 4',
      email:    'admin4@launcx.com',
      password: hash,
      role:     'ADMIN',
      isActive: true,
    }
  });
  console.log('✅ Admin ready: admin@launcx.com / supersecret');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
