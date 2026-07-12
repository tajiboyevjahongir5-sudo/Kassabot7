import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ 
  connectionString,
  max: 5,                     // 5 per process * 9 processes = 45 total connections
  min: 1,                     // keep 1 warm connection always ready
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: { rejectUnauthorized: false }
});

const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
