import { one, query, isDemo } from './db';
import { checkPin } from './password';
import { googleOn } from './google';
import { channelOn } from './otp';
import { paystackOn } from './payments';
import { s3On } from './storage';
import { backupsEnabled, backupStatus } from './backup';
import { smsOn, whatsappOn } from './messages';
import { envProblems, onVercel, databaseUrl, dbHost, isRenderInternal, isStaging } from './envcheck';
import { paystackMode } from './connections';
import { parseDsn } from './errorReport';
import { googleRedirectUri } from './google';
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from './settings';
import { FONTS, fontDir } from './studio/fonts';
import { launchState, launchBookLines } from './launchPrices';
import { businessForm, makeBusiness } from './business';

export type Check = { id: string; group: string; label: string; status: 'ok' | 'warn' | 'bad' | 'info'; detail: string; fix?: string };

/** Everything an admin needs to know before real customers arrive: what is switched on, and what is missing. */
export async function setupChecks(env: NodeJS.ProcessEnv = process.env): Promise<{ checks: Check[]; problems: number; warnings: number }> {
  const demo = isDemo(env);
  const c: Check[] = [];
  const add = (x: Check) => c.push(x);

  add(demo
    ? { id: 'mode', group: 'Basics', label: 'Mode', status: 'warn', detail: 'Demo mode is on. Sign-in codes appear on screen, payments are pretend, and demo staff exist.', fix: 'Set DEMO_MODE=false before real customers arrive.' }
    : { id: 'mode', group: 'Basics', label: 'Mode', status: 'ok', detail: 'Live mode.' });

  const staging = isStaging(env);
  if (staging) add({ id: 'staging', group: 'Basics', label: 'This copy', status: 'info', detail: 'This is the private test site (APP_ENV=staging). Search engines are told to stay away, and payments should be Paystack test payments.', fix: env.STAGING_PASSWORD ? undefined : 'Set STAGING_PASSWORD so only your team can open it.' });

  const url = env.NEXT_PUBLIC_APP_URL ?? '';
  const temp = /^https:\/\/[^/]*\.(onrender\.com|vercel\.app)(\/|$)/i.test(url);
  add(/^https:\/\/(?!localhost)/.test(url)
    ? temp && !demo && !staging
      ? { id: 'url', group: 'Basics', label: 'Site address', status: 'warn', detail: `${url} is a temporary address.`, fix: 'Point your own domain at the site and set NEXT_PUBLIC_APP_URL to it before you share the link, run ads or ask Google to index it. Addresses people have already seen would have to be changed later.' }
      : { id: 'url', group: 'Basics', label: 'Site address', status: 'ok', detail: url }
    : { id: 'url', group: 'Basics', label: 'Site address', status: demo ? 'info' : 'bad', detail: url ? `Set to ${url}.` : 'Not set.', fix: 'Set NEXT_PUBLIC_APP_URL to your real https address. Payment returns, Google sign-in and every message link depend on it.' });

  add((env.SESSION_SECRET ?? '').length >= 16
    ? { id: 'secret', group: 'Basics', label: 'Session secret', status: 'ok', detail: 'Set.' }
    : { id: 'secret', group: 'Basics', label: 'Session secret', status: demo ? 'info' : 'bad', detail: 'Not set or too short.', fix: 'Set SESSION_SECRET to a long random string (openssl rand -hex 32).' });

  if (databaseUrl(env)) {
    const host = dbHost(databaseUrl(env));
    const priv = isRenderInternal(host);
    const t0 = Date.now();
    let ms = -1;
    try { await query('select 1'); ms = Date.now() - t0; } catch { /* the health check reports this */ }
    const kind = priv ? 'Render\'s private address, reachable only from inside Render' : 'a public address';
    if (env.RENDER && !priv) add({ id: 'db', group: 'Basics', label: 'Database', status: 'warn', detail: `Hosted Postgres on ${kind}${ms >= 0 ? `, answering in ${ms} ms` : ''}.`, fix: 'The site runs inside Render, so use the database\'s Internal address (set DATABASE_URL "from database" in the Environment tab). It is faster and the database can stay closed to the internet.' });
    else if (ms < 0) add({ id: 'db', group: 'Basics', label: 'Database', status: 'bad', detail: 'The database did not answer.', fix: 'Open /api/health: it says in plain words what to change.' });
    else if (ms > 250) add({ id: 'db', group: 'Basics', label: 'Database', status: 'warn', detail: `Hosted Postgres on ${kind}, but it took ${ms} ms to answer.`, fix: 'Every page waits on this. Put the site and the database in the same region (Frankfurt is nearest to Lagos), or use the database\'s direct address.' });
    else add({ id: 'db', group: 'Basics', label: 'Database', status: 'ok', detail: `Hosted Postgres on ${kind}, answering in ${ms} ms.` });
  } else {
    add({ id: 'db', group: 'Basics', label: 'Database', status: demo ? 'info' : 'bad', detail: 'Using the built-in local database.', fix: 'Set DATABASE_URL to a hosted Postgres (Supabase, Railway, Render). The built-in database is lost when a server is replaced.' });
  }

  // Team
  const staff = await query<{ pin_hash: string; role: string; name: string }>('select pin_hash, role, name from staff where active');
  const admins = staff.filter((s) => s.role === 'admin').length;
  add(admins > 0
    ? { id: 'admin', group: 'Team', label: 'Admin', status: 'ok', detail: `${admins} active admin${admins > 1 ? 's' : ''}.` }
    : { id: 'admin', group: 'Team', label: 'Admin', status: 'bad', detail: 'No active admin.', fix: 'Set ADMIN_EMAIL and ADMIN_PIN and restart.' });
  const demoPin = staff.filter((s) => checkPin('1234', s.pin_hash)).length;
  add(demoPin > 0 && !demo
    ? { id: 'pins', group: 'Team', label: 'Staff PINs', status: 'bad', detail: `${demoPin} team member${demoPin > 1 ? 's' : ''} still use the demo PIN 1234.`, fix: 'Open Team and reset their PINs, or switch them off.' }
    : { id: 'pins', group: 'Team', label: 'Staff PINs', status: demoPin ? 'info' : 'ok', detail: demoPin ? 'Demo staff use the PIN 1234. Fine for a demo.' : 'No one uses a demo PIN.' });

  // Taking money
  const hook = `${url || 'https://your-site'}/api/webhooks/paystack`;
  const pmode = paystackMode(env.PAYSTACK_SECRET_KEY);
  if (!paystackOn()) add({ id: 'pay', group: 'Payments', label: 'Paystack', status: demo ? 'warn' : 'bad', detail: demo ? 'No key. Payments are pretend.' : 'No key. Customers cannot pay.', fix: `Set PAYSTACK_SECRET_KEY and add the webhook URL ${hook} in Paystack.` });
  else if (!demo && !staging && pmode === 'test') add({ id: 'pay', group: 'Payments', label: 'Paystack', status: 'bad', detail: 'The key is a TEST key (sk_test_). Customers would "pay" but no money would reach you.', fix: 'Replace it with your live secret key (sk_live_) from Paystack, Settings, API Keys & Webhooks, once Paystack has approved your business.' });
  else if (staging && pmode === 'live') add({ id: 'pay', group: 'Payments', label: 'Paystack', status: 'bad', detail: 'The test site has a LIVE key (sk_live_). Anyone testing would charge real cards.', fix: 'Use your test secret key (sk_test_) here.' });
  else add({ id: 'pay', group: 'Payments', label: 'Paystack', status: 'ok', detail: `Key set (${pmode === 'unknown' ? 'unusual format' : pmode} mode). Press "Test Paystack" below to prove it works.`, fix: `Check the webhook in Paystack points to ${hook}.` });

  // Sign-in
  const methods = [['Google', googleOn(), 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'], ['Email codes', channelOn('email'), 'RESEND_API_KEY and EMAIL_FROM'], ['SMS codes', channelOn('phone'), 'SMS_API_KEY']] as const;
  const redirect = url ? `${url.replace(/\/$/, '')}/api/auth/google/callback` : googleRedirectUri();
  for (const [label, on, vars] of methods) {
    const fix = on ? (label === 'Google' ? `Google must list ${redirect} as an authorised redirect URI, or sign-in fails with "redirect_uri_mismatch".` : label === 'Email codes' ? 'Press "Send a test email" below, and check it arrives (and not in spam).' : undefined) : `Set ${vars} to switch it on.${label === 'Google' ? ` In Google Cloud add ${redirect} as an authorised redirect URI.` : ''}`;
    add({ id: `signin-${label}`, group: 'Sign-in', label, status: on ? 'ok' : 'info', detail: on ? 'On.' : demo ? 'Demo stand-in.' : 'Off, so customers do not see this option.', fix });
  }
  const fromDomain = /<?[^<>@\s]+@([^<>\s]+)>?\s*$/.exec(env.EMAIL_FROM ?? '')?.[1]?.toLowerCase();
  const siteHost = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  if (fromDomain && siteHost && !temp && !(fromDomain === siteHost || fromDomain.endsWith(`.${siteHost}`))) add({ id: 'email-domain', group: 'Sign-in', label: 'Email sender', status: 'info', detail: `Emails are sent from ${fromDomain}, not from ${siteHost}.`, fix: 'Customers trust mail that comes from the same name as the website. Verify your own domain in Resend and use an address on it.' });
  if (!demo && !methods.some(([, on]) => on)) add({ id: 'signin-none', group: 'Sign-in', label: 'Customer sign-in', status: 'warn', detail: 'No sign-in method is set up. Customers can still check out as guests.', fix: 'Switch on at least Google or email codes.' });

  // Reaching customers
  const reach = whatsappOn(env) || smsOn(env);
  add({ id: 'messages', group: 'Messages', label: 'Order updates', status: reach ? 'ok' : demo ? 'info' : 'bad', detail: whatsappOn(env) ? 'WhatsApp Business Platform on.' : smsOn(env) ? 'Sent by SMS.' : 'No way to message customers.', fix: reach ? undefined : 'Set SMS_API_KEY, or the two WHATSAPP_ values, so customers hear about every stage.' });
  const biz = makeBusiness(await businessForm().catch(() => ({})), env);
  add(biz.whatsapp
    ? { id: 'wa', group: 'Messages', label: 'WhatsApp number on the site', status: 'ok', detail: `+${biz.whatsapp}` }
    : { id: 'wa', group: 'Messages', label: 'WhatsApp number on the site', status: 'warn', detail: 'Not set, so there is no "talk to a person" button.', fix: 'Type it in Settings, Business details (for example 0803 123 4567).' });
  add(biz.email || biz.phone
    ? { id: 'contact-details', group: 'Messages', label: 'Contact details on the site', status: 'ok', detail: [biz.phone, biz.email].filter(Boolean).join(' · ') }
    : { id: 'contact-details', group: 'Messages', label: 'Contact details on the site', status: 'info', detail: 'No phone number or email is shown on the contact page.', fix: 'Add them in Settings, Business details if you want customers to see them.' });
  const phoneReach = whatsappOn(env) || smsOn(env);
  add(env.ALERT_PHONE
    ? phoneReach
      ? { id: 'alert', group: 'Messages', label: 'Alerts to your phone', status: 'ok', detail: 'Jobs at risk of being late, payments we could not apply, a database outage, a failed backup and failed five-minute checks are sent to the alert number. Use "Test the connections" below to see one arrive.' }
      : { id: 'alert', group: 'Messages', label: 'Alerts to your phone', status: 'bad', detail: 'ALERT_PHONE is set, but neither SMS nor WhatsApp is, so no alert can be sent.', fix: 'Set SMS_API_KEY, or the two WHATSAPP values.' }
    : { id: 'alert', group: 'Messages', label: 'Alerts to your phone', status: demo || staging ? 'info' : 'warn', detail: 'No alert number. A failed payment, a database outage or a failed backup would only show here and in Sentry, and late jobs only in the queue.', fix: 'Set ALERT_PHONE to your own number, with the country code, for example 2348031234567.' });

  // Abuse limits
  const hops = env.TRUSTED_PROXY_HOPS;
  add(hops && Number(hops) > 0
    ? { id: 'proxy', group: 'Security', label: 'Visitor addresses', status: 'ok', detail: `Counting ${hops} proxy hop${Number(hops) > 1 ? 's' : ''} from the end of the address list.` }
    : { id: 'proxy', group: 'Security', label: 'Visitor addresses', status: demo ? 'info' : 'warn', detail: 'Rate limits use the first address a visitor sends, which anyone can fake.', fix: 'Open the "Your address" box at the bottom of this page from your own phone and set TRUSTED_PROXY_HOPS until it shows your real address. Team sign-in is locked per account either way.' });

  // Knowing when it breaks
  add(parseDsn(env.SENTRY_DSN)
    ? { id: 'errors', group: 'Watching the site', label: 'Error alerts', status: 'ok', detail: 'Every server error is sent to Sentry, which emails the team. Customer details are never sent.' }
    : env.SENTRY_DSN
      ? { id: 'errors', group: 'Watching the site', label: 'Error alerts', status: 'warn', detail: 'SENTRY_DSN is set but is not a Sentry address, so nothing is sent.', fix: 'Copy the DSN again from Sentry, Project settings, Client Keys. It looks like https://abc123@o123.ingest.sentry.io/456.' }
      : { id: 'errors', group: 'Watching the site', label: 'Error alerts', status: demo || staging ? 'info' : 'warn', detail: 'Nobody is told when the site hits an error; you would find out from a customer.', fix: 'Make a free project at sentry.io (platform: Node.js), and set SENTRY_DSN. Turn on email alerts for new issues.' });
  add({ id: 'uptime', group: 'Watching the site', label: 'Is it up?', status: 'info', detail: `Point a free uptime monitor (UptimeRobot or Better Stack) at ${url || 'your site'}/api/health and have it text you. This page cannot see it from the inside.`, fix: 'The monitor should look for "ok":true in the answer.' });

  // Keeping the promise
  add(env.CRON_SECRET || demo
    ? { id: 'cron-secret', group: 'The Promise', label: 'Sweep protection', status: 'ok', detail: env.CRON_SECRET ? 'CRON_SECRET set.' : 'Open in demo mode.' }
    : { id: 'cron-secret', group: 'The Promise', label: 'Sweep protection', status: 'warn', detail: 'CRON_SECRET not set. The outside scheduler endpoint is closed.', fix: 'Set CRON_SECRET. Needed on Vercel; the built-in scheduler works without it.' });
  const last = await one<{ at: string }>("select at from events where name = 'sweep' order by at desc limit 1");
  const mins = last ? Math.round((Date.now() - new Date(last.at).getTime()) / 60000) : null;
  add(mins != null && mins <= 15
    ? { id: 'sweep', group: 'The Promise', label: 'Late-order check', status: 'ok', detail: `Last ran ${mins === 0 ? 'just now' : `${mins} minute${mins > 1 ? 's' : ''} ago`}.` }
    : { id: 'sweep', group: 'The Promise', label: 'Late-order check', status: demo ? 'info' : 'warn', detail: mins == null ? 'It has not run yet.' : `Last ran ${mins} minutes ago.`, fix: 'This marks jobs at risk and refunds late 24-hour orders. It runs by itself every 5 minutes on a normal host. On Vercel, set CRON_SECRET.' });

  // Files
  const vercel = onVercel(env);
  add(s3On()
    ? { id: 'files', group: 'Files', label: 'Artwork storage', status: 'ok', detail: 'S3-compatible bucket.' }
    : vercel
      ? { id: 'files', group: 'Files', label: 'Artwork storage', status: 'bad', detail: 'Local disk. Vercel has no disk that keeps files, so artwork uploads fail.', fix: 'Set the S3_ values (Cloudflare R2 is cheap): DEPLOY.md, Path D.' }
      : { id: 'files', group: 'Files', label: 'Artwork storage', status: demo ? 'info' : 'warn', detail: 'Local disk.', fix: 'Fine if the host has a persistent disk that is backed up. Otherwise set the S3_ values (Cloudflare R2 is cheap).' });
  if (vercel) add({ id: 'vercel-upload', group: 'Files', label: 'Upload size on Vercel', status: 'warn', detail: 'Vercel refuses any request over about 4.5 MB, so uploads are capped at 4 MB on this host whatever the setting says. Most print artwork is bigger.', fix: 'For print-size files, host on Render (DEPLOY.md, Path A), or ask for direct-to-storage uploads.' });

  // Our own copy of the database
  const bk = backupsEnabled(env);
  if (!bk.on) {
    add({ id: 'backup', group: 'Backups', label: 'Nightly backup', status: demo ? 'info' : bk.why === 'BACKUPS=off' ? 'warn' : 'bad', detail: demo ? 'Off in demo mode.' : bk.why === 'BACKUPS=off' ? 'Switched off with BACKUPS=off.' : `Not running: ${bk.why}.`, fix: demo ? undefined : bk.why === 'BACKUPS=off' ? 'Remove BACKUPS=off. A shop without a backup of its orders is one bad day from closing.' : 'Set the S3_ values (Cloudflare R2). The backup is stored there, away from the host.' });
  } else {
    try {
      const b = await backupStatus();
      const hours = b.newest ? (Date.now() - b.newest.modified.getTime()) / 3_600_000 : null;
      const ago = (h: number) => (h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`);
      const mb = (n: number) => (n < 1_048_576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1_048_576).toFixed(1)} MB`);
      if (b.newest && hours != null) {
        add(hours <= 26
          ? { id: 'backup', group: 'Backups', label: 'Nightly backup', status: 'ok', detail: `Last backup ${ago(hours)} (${mb(b.newest.bytes)}). ${b.count} daily and ${b.monthly} monthly cop${b.count + b.monthly === 2 ? 'y' : 'ies'} kept.` }
          : { id: 'backup', group: 'Backups', label: 'Nightly backup', status: hours > 50 ? 'bad' : 'warn', detail: `The last backup is ${ago(hours)}. It should be taken every night.${b.lastFail ? ` The last attempt failed: ${b.lastFail.error}` : ''}`, fix: 'Press "Back up now" below and read the answer. If it fails, the message says why (usually the bucket keys).' });
      } else {
        add({ id: 'backup', group: 'Backups', label: 'Nightly backup', status: demo || staging ? 'info' : 'warn', detail: `There is no backup yet.${b.lastFail ? ` The last attempt failed: ${b.lastFail.error}` : ' The first one is taken a few minutes after the site starts.'}`, fix: 'Press "Back up now" below to take the first one.' });
      }
      add(!b.restore
        ? { id: 'restore', group: 'Backups', label: 'Restore test', status: 'info', detail: 'Not run yet. It runs by itself once a month, the first time within a day of the first backup.', fix: 'Press "Test a restore" below to run it now.' }
        : b.restore.ok
          ? { id: 'restore', group: 'Backups', label: 'Restore test', status: b.lastRestoreOk && Date.now() - b.lastRestoreOk.getTime() > 35 * 86_400_000 ? 'warn' : 'ok', detail: `Passed ${ago((Date.now() - b.restore.at.getTime()) / 3_600_000)}: all ${(b.restore.rows ?? 0).toLocaleString('en-NG')} saved rows came back in a scratch database and the money added up.` }
          : { id: 'restore', group: 'Backups', label: 'Restore test', status: 'bad', detail: `Failed ${ago((Date.now() - b.restore.at.getTime()) / 3_600_000)}: ${b.restore.error ?? 'unknown'}. The backup file may not be usable.`, fix: 'Press "Back up now" and then "Test a restore". If it still fails, send the message to your developer: it is the most important thing on this page.' });
      if (!s3On()) add({ id: 'backup-where', group: 'Backups', label: 'Where backups are kept', status: demo ? 'info' : 'warn', detail: 'On the same disk as the site. If that disk is lost, so are the backups.', fix: 'Set the S3_ values (Cloudflare R2) so backups live somewhere else.' });
    } catch (e) {
      add({ id: 'backup', group: 'Backups', label: 'Nightly backup', status: 'warn', detail: `Could not read the list of backups: ${(e as Error).message}`, fix: 'Run "Test file storage" below. Backups use the same bucket.' });
    }
  }

  // Brandit Studio (AI designs)
  const st = await getSettings();
  const vendorKeys: [string, boolean][] = [['Recraft', !!env.RECRAFT_API_KEY], ['FLUX', !!env.BFL_API_KEY], ['Google', !!(env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY)], ['OpenAI', !!env.OPENAI_API_KEY]];
  const drawers = vendorKeys.filter(([, on]) => on).map(([n]) => n);
  if (!st.studio_enabled) {
    add({ id: 'studio', group: 'Brandit Studio', label: 'Studio', status: 'info', detail: 'Switched off in Studio settings, so customers do not see it.' });
  } else {
    add(drawers.length
      ? { id: 'studio-keys', group: 'Brandit Studio', label: 'Picture makers', status: 'ok', detail: `Connected: ${drawers.join(', ')}.`, fix: 'Run "Test the connections" on the Studio page after any change.' }
      : { id: 'studio-keys', group: 'Brandit Studio', label: 'Picture makers', status: demo ? 'info' : 'warn', detail: demo ? 'No vendor key. The built-in demo drawing engine is used.' : 'No vendor key, so Studio stays closed to customers.', fix: 'Set RECRAFT_API_KEY (and one of BFL_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY). Run scripts/studio-bakeoff.ts first to choose.' });
    if (vercel && drawers.length) add({ id: 'studio-vercel', group: 'Brandit Studio', label: 'Studio on Vercel', status: 'warn', detail: 'Vercel pauses a server copy as soon as it has replied, so a picture job can stop part-way. The five-minute check picks stalled jobs up again, but customers will wait longer than they should.', fix: 'Keep Studio closed to customers on Vercel, or host on Render (DEPLOY.md, Path A).' });
    let fontsOk = true;
    try { fontsOk = FONTS.every((f) => [f.files.regular, f.files.bold].every((x) => fs.existsSync(path.join(fontDir(), x)))); } catch { fontsOk = false; }
    add(fontsOk
      ? { id: 'studio-fonts', group: 'Brandit Studio', label: 'Fonts for words', status: 'ok', detail: 'All Studio fonts are in the build.' }
      : { id: 'studio-fonts', group: 'Brandit Studio', label: 'Fonts for words', status: 'bad', detail: 'Studio font files are missing from this deploy, so designs cannot be made.', fix: 'Deploy the studio-assets folder with the app (render.yaml and the Dockerfile copy it). Or set STUDIO_FONT_DIR.' });
    add(env.OPENAI_API_KEY
      ? { id: 'studio-moderation', group: 'Brandit Studio', label: 'Image-safety check', status: 'ok', detail: 'Finished pictures are checked by OpenAI moderation as well as Brandit\'s own rules.' }
      : { id: 'studio-moderation', group: 'Brandit Studio', label: 'Image-safety check', status: demo ? 'info' : 'warn', detail: 'No OPENAI_API_KEY. Only Brandit\'s own word rules run, so a person must look at results.', fix: 'Set OPENAI_API_KEY, or keep "Every paid design" under Human checks in Studio settings.' });
    add({ id: 'studio-access', group: 'Brandit Studio', label: 'Who can use it', status: 'info', detail: st.studio_access === 'everyone' ? 'Everyone.' : 'Only people on the invite list.', fix: st.studio_access === 'everyone' ? undefined : 'Switch to Everyone in Studio settings when the overview numbers look right.' });
    add(st.studio_review_mode === 'off' && !env.OPENAI_API_KEY && !demo
      ? { id: 'studio-review', group: 'Brandit Studio', label: 'Human checks', status: 'warn', detail: 'No human checks and no image-safety check. Nothing looks at what the picture makers draw.', fix: 'Set human checks to "Every paid design" while launching.' }
      : { id: 'studio-review', group: 'Brandit Studio', label: 'Human checks', status: 'ok', detail: st.studio_review_mode === 'all' ? 'A person looks at every paid design.' : st.studio_review_mode === 'sample' ? 'About one in five paid designs.' : 'Off (image-safety check is on).' });
  }

  // Content that needs a person
  const placeholders = ((await one<{ n: number }>('select (select count(*) from price_rules where provisional) + (select count(*) from delivery_zones where provisional) as n'))?.n) ?? 0;
  add(Number(placeholders) > 0
    ? { id: 'prices', group: 'Your numbers', label: 'Prices and delivery fees', status: demo ? 'info' : 'warn', detail: `${placeholders} are still placeholders.`, fix: 'Open Prices and rules and replace them with figures from your cost sheet.' }
    : { id: 'prices', group: 'Your numbers', label: 'Prices and delivery fees', status: 'ok', detail: 'All set by you.' });
  const hoursAgo = (h: number) => (h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`);
  try {
    const ls = await launchState();
    add(ls
      ? { id: 'launch-prices', group: 'Your numbers', label: 'Launch price book', status: 'ok', detail: `Loaded ${new Date(ls.loadedAt).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' })} by ${ls.by}: ${ls.lines} lines across ${ls.products} products. Your own changes in Products are the truth from here on; it never loads itself again.` }
      : { id: 'launch-prices', group: 'Your numbers', label: 'Launch price book', status: demo || staging ? 'info' : 'warn', detail: `Not loaded yet. The price book that came with Brandit holds ${launchBookLines()} price, add-on, quantity and delivery lines: the numbers you gave, with the gaps filled from what other Lagos printers publish (each line says which).`, fix: 'Press "Preview" and then "Load the launch price book" under Launch price book, further down this page. Or set LAUNCH_PRICES=yes and restart to load it on the next start.' });
  } catch { /* the check must never break the Setup page */ }
  // Phase 1 gate: the cost sheet is loaded, and a change made in the console reaches the site.
  try {
    const n = await one<{ products: number; priced: number; real: number; costed: number }>(
      `select (select count(*) from products where active and not sample) as products,
              (select count(distinct r.product_id) from price_rules r join products p on p.id = r.product_id
                 where p.active and not p.sample and r.active and not r.provisional and (r.price_kobo is not null or r.rate_per_sqft_kobo is not null)) as priced,
              (select count(*) from price_rules where active and not provisional and (price_kobo is not null or rate_per_sqft_kobo is not null)) as real,
              (select count(*) from price_rules where active and not provisional and (price_kobo is not null or rate_per_sqft_kobo is not null) and cost_kobo is not null) as costed`);
    const products = Number(n?.products ?? 0), priced = Number(n?.priced ?? 0), real = Number(n?.real ?? 0), costed = Number(n?.costed ?? 0);
    const loaded = products > 0 && priced === products && real > 0 && costed === real;
    add(loaded
      ? { id: 'cost-sheet', group: 'Your numbers', label: 'Your cost sheet', status: 'ok', detail: `Loaded: all ${products} products have confirmed prices, and every one of the ${real} prices has a cost.` }
      : { id: 'cost-sheet', group: 'Your numbers', label: 'Your cost sheet', status: demo || staging ? 'info' : 'warn',
          detail: `${priced} of ${products} products have a confirmed price. ${costed} of ${real} confirmed prices have a cost, so ${costed === 0 ? 'margin warnings cannot work yet' : 'margin warnings only cover those'}. Choices and tables without a confirmed price stay hidden from customers.`,
          fix: 'Open Products, Price sheet (Excel), download it, fill in the Price and Cost columns, upload it, check what it would change, then save.' });
    const last = await one<{ at: Date; actor: string; summary: string }>('select at, actor, summary from price_history order by at desc limit 1');
    add({ id: 'console-change', group: 'Your numbers', label: 'Console changes reach the site', status: 'info',
      detail: last ? `Prices change on the site the moment you save. Last change: ${last.summary} (${last.actor}, ${hoursAgo((Date.now() - new Date(last.at).getTime()) / 3_600_000)}).` : 'Prices change on the site the moment you save. No price change has been made yet.',
      fix: last ? undefined : 'To see it for yourself, change one price in the price grid, then open that product on the site. "Who changed what" in Products lists every change.' });
  } catch { /* the check must never break the Setup page */ }
  add({ id: 'legal', group: 'Your numbers', label: 'Terms and Privacy pages', status: 'info', detail: 'Drafts.', fix: 'Have a Nigerian lawyer review /legal/terms and /legal/privacy before taking public orders.' });

  return { checks: c, problems: c.filter((x) => x.status === 'bad').length, warnings: c.filter((x) => x.status === 'warn').length };
}

/** The few things that must be right for a live site to start at all. The rules live in envcheck.ts so the middleware can use them too. */
export function fatalProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  return envProblems(env);
}
