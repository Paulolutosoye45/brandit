import { isDemo, ready } from './db';
import { fatalProblems } from './setup';
import { dbHint } from './envcheck';
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
    const hint = dbHint(e);
    console.error(`\n[brandit] Cannot start: the database did not open.\n  ${(e as Error)?.message ?? e}${hint ? `\n  What to do: ${hint}` : ''}\n`);
    throw e;
  }
  const on = (b: boolean, n: string) => (b ? n : null);
  const signin = [on(googleOn(), 'google'), on(channelOn('email'), 'email'), on(channelOn('phone'), 'phone')].filter(Boolean).join(', ') || (isDemo() ? 'demo' : 'none');
  console.log(`[brandit] ${isDemo() ? 'DEMO' : 'LIVE'} | db: ${process.env.DATABASE_URL ? 'hosted' : 'built-in'} | payments: ${paystackOn() ? 'paystack' : isDemo() ? 'pretend' : 'OFF'} | sign-in: ${signin} | files: ${s3On() ? 's3' : 'disk'} | messages: ${whatsappOn() ? 'whatsapp' : smsOn() ? 'sms' : 'none'} | scheduler: ${startInternalScheduler()}`);
}
