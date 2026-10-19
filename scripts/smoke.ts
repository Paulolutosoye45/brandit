import { runSmoke, formatRows, failed } from '../lib/smoke';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const val = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const url = args.find((a) => /^https?:\/\//.test(a));

if (!url) {
  console.error('Usage: npm run smoke -- https://thebrandit.ng [--staging --password <team password>] [--allow-demo]\n       add  --deep --cron-secret <CRON_SECRET>  to also test file storage, Paystack, backups and the late-order check\n       add  --full  to start one unpaid N100 Paystack payment, and  --email you@example.com  to send one real email');
  process.exit(2);
}

console.log(`\nChecking ${url}${flag('staging') ? ' (test site)' : ''} ...\n`);
const secret = val('cron-secret') ?? process.env.CRON_SECRET;
if (flag('deep') && !secret) {
  console.error('--deep needs the site\'s CRON_SECRET: add  --cron-secret <value>  (or set CRON_SECRET in your environment).');
  process.exit(2);
}
runSmoke(url, { staging: flag('staging'), allowDemo: flag('allow-demo'), password: val('password'), deep: flag('deep') ? { secret: secret!, full: flag('full'), email: val('email') } : undefined }).then((rows) => {
  console.log(formatRows(rows) + '\n');
  process.exit(failed(rows) ? 1 : 0);
});
