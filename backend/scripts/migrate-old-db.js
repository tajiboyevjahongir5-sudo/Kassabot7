// Bir martalik ko'chirish: OLD_DATABASE_URL (masalan, eski Neon baza) dagi
// barcha ma'lumotlarni hozirgi DATABASE_URL (Railway Postgres) ga ko'chiradi.
// - Mavjud yozuvlar ustiga yozilmaydi (ON CONFLICT DO NOTHING).
// - Har bir OLD_DATABASE_URL uchun faqat bir marta ishlaydi (_old_db_migration jadvali).
// - Xato bo'lsa ham bot ishga tushishini to'xtatmaydi.
const { Client } = require('pg');
const crypto = require('crypto');

function sslFor(url) {
  if (!url || /\.railway\.internal|localhost|127\.0\.0\.1/.test(url)) return false;
  return { rejectUnauthorized: false };
}

function clean(url) {
  // pg kutubxonasi channel_binding parametrini qo'llamaydi
  return url.replace(/([?&])channel_binding=[^&]*&?/, '$1').replace(/[?&]$/, '');
}

async function main() {
  const oldUrl = process.env.OLD_DATABASE_URL;
  const newUrl = process.env.DATABASE_URL;
  if (!oldUrl || !newUrl) {
    console.log('[MIGRATE] OLD_DATABASE_URL yo\'q — ko\'chirish o\'tkazib yuborildi.');
    return;
  }
  if (clean(oldUrl) === clean(newUrl)) {
    console.log('[MIGRATE] OLD_DATABASE_URL va DATABASE_URL bir xil — o\'tkazib yuborildi.');
    return;
  }

  const tag = crypto.createHash('sha256').update(clean(oldUrl)).digest('hex').slice(0, 16);
  const dst = new Client({ connectionString: clean(newUrl), ssl: sslFor(newUrl) });
  await dst.connect();
  await dst.query('CREATE TABLE IF NOT EXISTS "_old_db_migration" (tag TEXT PRIMARY KEY, done_at TIMESTAMPTZ DEFAULT now(), summary TEXT)');
  const done = await dst.query('SELECT 1 FROM "_old_db_migration" WHERE tag=$1', [tag]);
  if (done.rowCount) {
    console.log('[MIGRATE] Bu eski baza allaqachon ko\'chirilgan — o\'tkazib yuborildi.');
    await dst.end();
    return;
  }

  const src = new Client({ connectionString: clean(oldUrl), ssl: sslFor(oldUrl), connectionTimeoutMillis: 15000 });
  try {
    await src.connect();
  } catch (e) {
    console.error('[MIGRATE] Eski bazaga ulanib bo\'lmadi:', e.message);
    await dst.end();
    return;
  }

  const listTables = async (c) => (await c.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT LIKE '\\_%'"
  )).rows.map(r => r.table_name);
  const listCols = async (c, t) => (await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [t]
  )).rows.map(r => r.column_name);

  const srcTables = await listTables(src);
  const dstTables = new Set(await listTables(dst));
  const summary = [];

  await dst.query('BEGIN');
  try {
    // FK tekshiruvlarini vaqtincha o'chirish (jadval tartibi muhim bo'lmasin)
    await dst.query("SET LOCAL session_replication_role = 'replica'");
    for (const t of srcTables) {
      if (!dstTables.has(t)) { summary.push(`${t}: yangi bazada yo'q`); continue; }
      const dstCols = new Set(await listCols(dst, t));
      const cols = (await listCols(src, t)).filter(c => dstCols.has(c));
      if (!cols.length) continue;
      const q = cols.map(c => `"${c}"`).join(',');
      const rows = (await src.query(`SELECT ${q} FROM "${t}"`)).rows;
      let inserted = 0;
      const batch = 500;
      for (let i = 0; i < rows.length; i += batch) {
        const chunk = rows.slice(i, i + batch);
        const params = [];
        const values = chunk.map(r => '(' + cols.map(c => { params.push(r[c]); return '$' + params.length; }).join(',') + ')').join(',');
        const res = await dst.query(`INSERT INTO "${t}" (${q}) VALUES ${values} ON CONFLICT DO NOTHING`, params);
        inserted += res.rowCount;
      }
      // autoincrement ketma-ketligini moslash
      if (cols.includes('id')) {
        const seq = await dst.query(`SELECT pg_get_serial_sequence('"${t}"','id') AS s`);
        if (seq.rows[0] && seq.rows[0].s) {
          await dst.query(`SELECT setval($1, GREATEST((SELECT COALESCE(MAX(id),0) FROM "${t}"),1))`, [seq.rows[0].s]);
        }
      }
      summary.push(`${t}: ${inserted}/${rows.length}`);
    }
    await dst.query('INSERT INTO "_old_db_migration"(tag, summary) VALUES ($1,$2)', [tag, summary.join('; ')]);
    await dst.query('COMMIT');
    console.log('[MIGRATE] Ko\'chirish tugadi:', summary.join('; '));
  } catch (e) {
    await dst.query('ROLLBACK');
    console.error('[MIGRATE] Ko\'chirishda xato (o\'zgarishlar bekor qilindi):', e.message);
  } finally {
    await src.end().catch(() => {});
    await dst.end().catch(() => {});
  }
}

main().catch(e => console.error('[MIGRATE] Kutilmagan xato:', e.message)).finally(() => process.exit(0));
