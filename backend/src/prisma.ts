import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const rawUrl = process.env.DATABASE_URL || '';
// ?schema=... parametri: kassabot jadvallari alohida sxemada turadi
// (Railway Postgres'dagi boshqa ma'lumotlarga tegmaslik uchun)
let schema: string | undefined;
let connectionString = rawUrl;
try {
  const u = new URL(rawUrl);
  schema = u.searchParams.get('schema') || undefined;
  u.searchParams.delete('schema');
  connectionString = u.toString();
} catch {}
const pool = new Pool({ 
  connectionString,
  max: 10,                    // Single process — 10 connections is optimal
  min: 2,                     // keep 2 warm connections always ready
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ...(schema ? { options: `-c search_path="${schema}"` } : {}),
  // Railway ichki tarmog'idagi Postgres uchun SSL kerak emas
  ssl: connectionString && /\.railway\.internal|localhost|127\.0\.0\.1/.test(connectionString)
    ? false
    : { rejectUnauthorized: false }
});

const adapter = new PrismaPg(pool, schema ? { schema } : undefined);
export const prisma = new PrismaClient({ adapter });
