/**
 * Look at, check, download and restore Brandit's own database backups (the ones taken every night into the file bucket).
 *
 *   npm run restore -- --list                                         what is in the bucket
 *   npm run restore -- backups/daily/2026-10-14.json.gz --check       rebuild it in a scratch database and check it (changes nothing)
 *   npm run restore -- backups/daily/2026-10-14.json.gz --download    save it to a file on this computer
 *   npm run restore -- backups/daily/2026-10-14.json.gz --into "postgresql://..." --yes
 *                                                                      put it into a database (replaces what is there)
 *
 * The first three need the S3_ values (the same as the site uses) in your environment. Instead of a name you can give the path of
 * a file you downloaded earlier. PowerShell:  $env:S3_ENDPOINT = "https://....r2.cloudflarestorage.com"  and so on.
 * For --into, use the new database's External URL. It can be empty; the tables are created for you.
 */
import fs from 'node:fs';
import { Client } from 'pg';
import { decodeBackup, createSchema, restoreBackup, runRestoreTestOn, totalRows, type Target } from '../lib/backup';
import { getNamed, listNamed, s3On } from '../lib/storage';
import { dbHint, dbSsl } from '../lib/envcheck';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const val = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const source = args.find((a) => !a.startsWith('--') && a !== val('into'));
const fail = (m: string): never => { console.error(`\n${m}\n`); process.exit(1); };

async function load(): Promise<Buffer> {
  if (!source) return fail('Say which backup. Use  --list  to see them, then for example:  npm run restore -- backups/daily/2026-10-14.json.gz --check');
  if (fs.existsSync(source)) return fs.readFileSync(source);
  if (!s3On()) return fail('That is not a file on this computer, and the S3_ values are not set, so the bucket cannot be read. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY first.');
  try { return await getNamed(source); } catch (e) { return fail(`Could not read ${source}: ${(e as Error).message}`); }
}

async function main() {
  if (flag('list')) {
    if (!s3On()) fail('Set the S3_ values first (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).');
    for (const p of ['backups/daily/', 'backups/monthly/'] as const) {
      const files = await listNamed(p);
      console.log(`\n${p}  (${files.length})`);
      for (const f of files) console.log(`  ${f.name}   ${(f.bytes / 1_048_576).toFixed(2)} MB   ${f.modified.toISOString()}`);
    }
    console.log('');
    return;
  }

  const buf = await load();
  if (flag('download')) {
    const out = val('download') && !val('download')!.startsWith('--') ? val('download')! : `${source!.split('/').pop()}`;
    fs.writeFileSync(out, buf);
    console.log(`\nSaved ${out} (${(buf.length / 1_048_576).toFixed(2)} MB). Keep it somewhere safe: it holds customer details.\n`);
    return;
  }
  let backup;
  try { backup = decodeBackup(buf); } catch (e) { return fail((e as Error).message); }
  console.log(`\nBackup taken ${backup.createdAt}${backup.build ? ` (site version ${backup.build})` : ''}: ${totalRows(backup).toLocaleString('en-NG')} rows in ${Object.keys(backup.tables).length} tables, ${backup.counts.orders ?? 0} orders, ${backup.counts.customers ?? 0} customers.`);

  if (flag('check')) {
    const r = await runRestoreTestOn(backup);
    console.log(r.ok ? `\nGood. It rebuilds whole in a scratch database: every row came back and the money adds up. Nothing was changed anywhere.\n` : `\nFAILED: ${r.error}\n`);
    process.exit(r.ok ? 0 : 1);
  }

  const into = val('into');
  if (!into) return fail('Say where to put it:  --into "postgresql://..."   (or use --check to only test it).');
  if (!flag('yes')) return fail(`This would REPLACE everything in that database with the backup. Run the same command again with --yes to go ahead.`);
  const c = new Client({ connectionString: into, ssl: dbSsl({ ...process.env, DATABASE_URL: into } as any), connectionTimeoutMillis: 15_000 });
  try { await c.connect(); } catch (e) { return fail(`Could not open that database: ${(e as Error).message}${dbHint(e) ? `\n${dbHint(e)}` : ''}`); }
  const t: Target = { query: async (sql, params) => (await c.query(sql, params as any[])).rows, exec: async (sql) => { await c.query(sql); } };
  try {
    const tables = Number((await t.query("select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"))[0].n);
    if (tables === 0) { console.log('The database is empty: creating the tables first...'); await createSchema(t, backup); }
    console.log('Restoring (all or nothing)...');
    const r = await restoreBackup(t, backup);
    console.log(`\nDone. ${r.rows.toLocaleString('en-NG')} rows restored into ${r.tables} tables, every link between tables checked, the money adds up.`);
    console.log('Next: point the site\'s DATABASE_URL at this database, redeploy, then run  npm run smoke -- https://thebrandit.ng\n');
  } catch (e) {
    fail(`The restore did not go through, and nothing was changed: ${(e as Error).message}`);
  } finally { await c.end().catch(() => {}); }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
