import { one, query, isDemo } from './db';
import { checkPin } from './password';
import { googleOn } from './google';
import { channelOn } from './otp';
import { paystackOn } from './payments';
import { s3On } from './storage';
import { smsOn, whatsappOn } from './messages';
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from './settings';
import { FONTS, fontDir } from './studio/fonts';

export type Check = { id: string; group: string; label: string; status: 'ok' | 'warn' | 'bad' | 'info'; detail: string; fix?: string };

/** Everything an admin needs to know before real customers arrive: what is switched on, and what is missing. */
export async function setupChecks(env: NodeJS.ProcessEnv = process.env): Promise<{ checks: Check[]; problems: number; warnings: number }> {
  const demo = isDemo(env);
  const c: Check[] = [];
  const add = (x: Check) => c.push(x);

  add(demo
    ? { id: 'mode', group: 'Basics', label: 'Mode', status: 'warn', detail: 'Demo mode is on. Sign-in codes appear on screen, payments are pretend, and demo staff exist.', fix: 'Set DEMO_MODE=false before real customers arrive.' }
    : { id: 'mode', group: 'Basics', label: 'Mode', status: 'ok', detail: 'Live mode.' });

  const url = env.NEXT_PUBLIC_APP_URL ?? '';
  add(/^https:\/\/(?!localhost)/.test(url)
    ? { id: 'url', group: 'Basics', label: 'Site address', status: 'ok', detail: url }
    : { id: 'url', group: 'Basics', label: 'Site address', status: demo ? 'info' : 'bad', detail: url ? `Set to ${url}.` : 'Not set.', fix: 'Set NEXT_PUBLIC_APP_URL to your real https address. Payment returns, Google sign-in and every message link depend on it.' });

  add((env.SESSION_SECRET ?? '').length >= 16
    ? { id: 'secret', group: 'Basics', label: 'Session secret', status: 'ok', detail: 'Set.' }
    : { id: 'secret', group: 'Basics', label: 'Session secret', status: demo ? 'info' : 'bad', detail: 'Not set or too short.', fix: 'Set SESSION_SECRET to a long random string (openssl rand -hex 32).' });

  add(env.DATABASE_URL
    ? { id: 'db', group: 'Basics', label: 'Database', status: 'ok', detail: 'Hosted Postgres.' }
    : { id: 'db', group: 'Basics', label: 'Database', status: demo ? 'info' : 'bad', detail: 'Using the built-in local database.', fix: 'Set DATABASE_URL to a hosted Postgres (Supabase, Railway, Render). The built-in database is lost when a server is replaced.' });

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
  add(paystackOn()
    ? { id: 'pay', group: 'Payments', label: 'Paystack', status: 'ok', detail: 'Key set.', fix: `Check the webhook in Paystack points to ${url || 'your site'}/api/webhooks/paystack.` }
    : { id: 'pay', group: 'Payments', label: 'Paystack', status: demo ? 'warn' : 'bad', detail: demo ? 'No key. Payments are pretend.' : 'No key. Customers cannot pay.', fix: 'Set PAYSTACK_SECRET_KEY and add the webhook URL in Paystack.' });

  // Sign-in
  const methods = [['Google', googleOn(), 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'], ['Email codes', channelOn('email'), 'RESEND_API_KEY and EMAIL_FROM'], ['SMS codes', channelOn('phone'), 'SMS_API_KEY']] as const;
  for (const [label, on, vars] of methods) add({ id: `signin-${label}`, group: 'Sign-in', label, status: on ? 'ok' : 'info', detail: on ? 'On.' : demo ? 'Demo stand-in.' : 'Off, so customers do not see this option.', fix: on ? undefined : `Set ${vars} to switch it on.` });
  if (!demo && !methods.some(([, on]) => on)) add({ id: 'signin-none', group: 'Sign-in', label: 'Customer sign-in', status: 'warn', detail: 'No sign-in method is set up. Customers can still check out as guests.', fix: 'Switch on at least Google or email codes.' });

  // Reaching customers
  const reach = whatsappOn() || smsOn();
  add({ id: 'messages', group: 'Messages', label: 'Order updates', status: reach ? 'ok' : demo ? 'info' : 'bad', detail: whatsappOn() ? 'WhatsApp Business Platform on.' : smsOn() ? 'Sent by SMS.' : 'No way to message customers.', fix: reach ? undefined : 'Set SMS_API_KEY, or the two WHATSAPP_ values, so customers hear about every stage.' });
  add(env.NEXT_PUBLIC_WHATSAPP
    ? { id: 'wa', group: 'Messages', label: 'WhatsApp number on the site', status: 'ok', detail: `+${env.NEXT_PUBLIC_WHATSAPP}` }
    : { id: 'wa', group: 'Messages', label: 'WhatsApp number on the site', status: 'warn', detail: 'Not set, so there is no "talk to a person" button.', fix: 'Set NEXT_PUBLIC_WHATSAPP, for example 2348031234567.' });
  add(env.ALERT_PHONE
    ? { id: 'alert', group: 'Messages', label: 'At-risk alerts', status: 'ok', detail: 'Sent to the alert number.' }
    : { id: 'alert', group: 'Messages', label: 'At-risk alerts', status: 'info', detail: 'No alert number. At-risk jobs show in the queue only.', fix: 'Set ALERT_PHONE to your production lead\'s number.' });

  // Abuse limits
  const hops = env.TRUSTED_PROXY_HOPS;
  add(hops && Number(hops) > 0
    ? { id: 'proxy', group: 'Security', label: 'Visitor addresses', status: 'ok', detail: `Counting ${hops} proxy hop${Number(hops) > 1 ? 's' : ''} from the end of the address list.` }
    : { id: 'proxy', group: 'Security', label: 'Visitor addresses', status: demo ? 'info' : 'warn', detail: 'Rate limits use the first address a visitor sends, which anyone can fake.', fix: 'Open the "Your address" box at the bottom of this page from your own phone and set TRUSTED_PROXY_HOPS until it shows your real address. Team sign-in is locked per account either way.' });

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
  add(s3On()
    ? { id: 'files', group: 'Files', label: 'Artwork storage', status: 'ok', detail: 'S3-compatible bucket.' }
    : { id: 'files', group: 'Files', label: 'Artwork storage', status: demo ? 'info' : 'warn', detail: 'Local disk.', fix: 'Fine if the host has a persistent disk that is backed up. Otherwise set the S3_ values (Cloudflare R2 is cheap).' });

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
  add({ id: 'legal', group: 'Your numbers', label: 'Terms and Privacy pages', status: 'info', detail: 'Drafts.', fix: 'Have a Nigerian lawyer review /legal/terms and /legal/privacy before taking public orders.' });

  return { checks: c, problems: c.filter((x) => x.status === 'bad').length, warnings: c.filter((x) => x.status === 'warn').length };
}

/** The few things that must be right for a live site to start at all. */
export function fatalProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (isDemo(env)) return [];
  const p: string[] = [];
  if ((env.SESSION_SECRET ?? '').length < 16) p.push('SESSION_SECRET must be set to a long random string (16 characters or more).');
  if (!env.DATABASE_URL) p.push('DATABASE_URL must point to a hosted Postgres database. The built-in local database is for trying things out only.');
  return p;
}
