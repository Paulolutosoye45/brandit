import { isDemo, ready } from './db';
import { fatalProblems } from './setup';
import { dbHint, databaseUrl } from './envcheck';
import { startInternalScheduler } from './scheduler';
import { googleOn } from './google';
import { channelOn } from './otp';
import { paystackOn } from './payments';
import { s3On } from './storage';
import { smsOn, whatsappOn } from './messages';

/** Runs once when the server starts: refuse to serve on a broken live setup, say what is switched on, start the scheduler. */
export async function startup() {
  const problems = fatalProblems();
  if (problems.length) {
    // Do not crash: the middleware answers every request with a 503 page that says which settings are missing (and the health
    // check fails, so a host such as Render keeps the old version running). A crash would show visitors only "500".
    console.error(`\n[brandit] Cannot start in live mode. The site answers 503 until this is fixed:\n${problems.map((p) => `  - ${p}`).join('\n')}\n  (For a trial run on your own computer, set DEMO_MODE=true.)\n`);
    return;
  }
  try {
    await ready();
  } catch (e) {
    // Do not crash: a crash shows visitors a bare "500" and hides the reason. Instead every request tries the database
    // again, /api/health says in plain words what is wrong (and fails, so a host such as Render keeps the old version).
    const hint = dbHint(e);
    console.error(`\n[brandit] The database did not open. The site will keep trying; /api/health says why.\n  ${(e as Error)?.message ?? e}${hint ? `\n  What to do: ${hint}` : ''}\n`);
  }
  const on = (b: boolean, n: string) => (b ? n : null);
  const signin = [on(googleOn(), 'google'), on(channelOn('email'), 'email'), on(channelOn('phone'), 'phone')].filter(Boolean).join(', ') || (isDemo() ? 'demo' : 'none');
  console.log(`[brandit] ${isDemo() ? 'DEMO' : 'LIVE'} | db: ${databaseUrl(process.env) ? 'hosted' : 'built-in'} | payments: ${paystackOn() ? 'paystack' : isDemo() ? 'pretend' : 'OFF'} | sign-in: ${signin} | files: ${s3On() ? 's3' : 'disk'} | messages: ${whatsappOn() ? 'whatsapp' : smsOn() ? 'sms' : 'none'} | scheduler: ${startInternalScheduler()}`);
}
