import { isDemo, ready } from './db';
import { fatalProblems } from './setup';
import { startInternalScheduler } from './scheduler';
import { googleOn } from './google';
import { channelOn } from './otp';
import { paystackOn } from './payments';
import { s3On } from './storage';
import { smsOn, whatsappOn } from './messages';

/** Runs once when the server starts: stop on a broken live setup, say what is switched on, start the scheduler. */
export async function startup() {
  const problems = fatalProblems();
  if (problems.length) {
    console.error(`\n[brandit] Cannot start in live mode:\n${problems.map((p) => `  - ${p}`).join('\n')}\n  (For a trial run, set DEMO_MODE=true.)\n`);
    throw new Error('Brandit live-mode settings are incomplete.');
  }
  await ready();
  const on = (b: boolean, n: string) => (b ? n : null);
  const signin = [on(googleOn(), 'google'), on(channelOn('email'), 'email'), on(channelOn('phone'), 'phone')].filter(Boolean).join(', ') || (isDemo() ? 'demo' : 'none');
  console.log(`[brandit] ${isDemo() ? 'DEMO' : 'LIVE'} | db: ${process.env.DATABASE_URL ? 'hosted' : 'built-in'} | payments: ${paystackOn() ? 'paystack' : isDemo() ? 'pretend' : 'OFF'} | sign-in: ${signin} | files: ${s3On() ? 's3' : 'disk'} | messages: ${whatsappOn() ? 'whatsapp' : smsOn() ? 'sms' : 'none'} | scheduler: ${startInternalScheduler()}`);
}
