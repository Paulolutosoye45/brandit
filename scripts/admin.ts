/**
 * See the team accounts in your live database, and set an admin's PIN, from your own computer.
 *
 *   npm run admin -- list                             who can sign in to the console
 *   npm run admin -- set you@example.com 482915       make this address an active admin with this PIN
 *   npm run admin -- disable-demo                     switch off the demo accounts (...@brandit.test, PIN 1234)
 *
 * First point DATABASE_URL at the database's External URL. PowerShell:  $env:DATABASE_URL = "postgresql://..."
 * PINs are stored scrambled, so nobody can read one back: "set" is how you replace a forgotten PIN.
 */
import { Client } from 'pg';
import { databaseUrl, dbSsl, dbHint } from '../lib/envcheck';
import { hashPin } from '../lib/password';
import { validatePin } from '../lib/team';

const USAGE = 'Use:  npm run admin -- list   |   npm run admin -- set you@example.com 482915   |   npm run admin -- disable-demo';

async function main() {
  const [cmd, emailArg, pin] = process.argv.slice(2);
  const url = databaseUrl(process.env);
  if (!url) {
    console.log('Set DATABASE_URL to the database\'s External URL first. PowerShell:  $env:DATABASE_URL = "postgresql://..."');
    process.exit(1);
  }
  const c = new Client({ connectionString: url, ssl: dbSsl(process.env), connectionTimeoutMillis: 15_000 });
  try {
    await c.connect();
  } catch (e) {
    console.log(`Could not open the database: ${(e as Error).message}`);
    const hint = dbHint(e);
    if (hint) console.log(hint);
    process.exit(1);
  }
  try {
    if (cmd === 'list') {
      const { rows } = await c.query('select email, name, role, active from staff order by active desc, role, email');
      if (!rows.length) console.log('No team accounts yet. Create yours:  npm run admin -- set you@example.com <PIN>');
      for (const r of rows) console.log(`${r.active ? 'active  ' : 'off     '}  ${String(r.role).padEnd(16)}  ${r.email}  (${r.name})`);
      if (rows.some((r) => r.active && /@brandit\.test$/.test(r.email))) {
        console.log('\nWarning: demo accounts with PIN 1234 are switched on. Run:  npm run admin -- disable-demo');
      }
    } else if (cmd === 'set') {
      const email = String(emailArg ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !pin) throw new Error(USAGE);
      const bad = validatePin(pin);
      if (bad) { console.log(bad); process.exit(1); }
      await c.query(
        `insert into staff (email, name, role, pin_hash) values ($1, 'Admin', 'admin', $2)
         on conflict (email) do update set role = 'admin', active = true, pin_hash = excluded.pin_hash`,
        [email, hashPin(pin)],
      );
      console.log(`Done. ${email} is an active admin with the new PIN. Sign in at /console/login.`);
    } else if (cmd === 'disable-demo') {
      const r = await c.query("update staff set active = false where email like '%@brandit.test' and active");
      console.log(`Switched off ${r.rowCount ?? 0} demo account(s).`);
    } else {
      throw new Error(USAGE);
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.log((e as Error).message); process.exit(1); });
