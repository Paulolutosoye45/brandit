import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alertPaymentNotApplied, oneLine, paymentProblem, resetDatabaseWatch, resetSiteAlertMemory, siteAlert, watchDatabase } from '../lib/siteAlert';
import { sendStaffNow } from '../lib/messages';
import { checkWithPaystack } from '../lib/payments';
import { testAlert } from '../lib/connections';
import { resetErrorReportMemory } from '../lib/errorReport';
import { TEMPLATES, STAFF_TEMPLATES, render } from '../content/messages';

type Call = { url: string; body: any };
const recorder = (answer: (url: string) => Response = () => new Response('{}', { status: 200 })) => {
  const calls: Call[] = [];
  const f = (async (url: string, init: any) => {
    let body: any = init?.body;
    try { body = JSON.parse(init.body); } catch { /* sentry envelopes are not JSON */ }
    calls.push({ url: String(url), body });
    return answer(String(url));
  }) as unknown as typeof fetch;
  return { calls, f };
};

const SMS = { ALERT_PHONE: '2348031234567', SMS_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv;
const WA = { ALERT_PHONE: '2348031234567', WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '123' } as unknown as NodeJS.ProcessEnv;
const DSN = 'https://abc123key@o99.ingest.sentry.io/4507';

beforeEach(() => { resetSiteAlertMemory(); resetErrorReportMemory(); resetDatabaseWatch(); });
afterEach(() => { resetSiteAlertMemory(); resetErrorReportMemory(); });

describe('the site alert template', () => {
  it('is for our team: English only, one value, and does not start or end with that value', () => {
    expect(STAFF_TEMPLATES).toContain('site_alert');
    expect(TEMPLATES.site_alert.vars).toEqual(['what']);
    const text = render('site_alert', { what: 'The database is down.' }, 'pcm');
    expect(text).toBe(render('site_alert', { what: 'The database is down.' }, 'en'));
    expect(text).toMatch(/^Brandit site alert: The database is down\. /);
    expect(TEMPLATES.site_alert.text({ what: '{{1}}' })).not.toMatch(/\{\{1\}\}$/);
  });
});

describe('sending to the team right now', () => {
  it('uses WhatsApp when it is set up', async () => {
    const { calls, f } = recorder();
    const r = await sendStaffNow('+2348031234567', 'site_alert', { what: 'Test.' }, WA, f);
    expect(r).toEqual({ ok: true, channel: 'whatsapp' });
    expect(calls[0].url).toContain('graph.facebook.com');
    expect(calls[0].body.template.name).toBe('brandit_site_alert');
    expect(calls[0].body.to).toBe('2348031234567');
    expect(calls[0].body.template.components[0].parameters).toEqual([{ type: 'text', text: 'Test.' }]);
  });
  it('falls back to SMS, with the full wording, when WhatsApp refuses', async () => {
    const { calls, f } = recorder((u) => (u.includes('facebook') ? new Response('template not approved', { status: 400 }) : new Response('{}', { status: 200 })));
    const r = await sendStaffNow('2348031234567', 'site_alert', { what: 'Test.' }, { ...WA, SMS_API_KEY: 'k' } as any, f);
    expect(r.ok).toBe(true);
    expect(r.channel).toBe('sms');
    expect(r.error).toMatch(/WhatsApp failed/);
    expect(calls[1].body.sms).toBe('Brandit site alert: Test. Open the console, Setup page, to look into it.');
  });
  it('says plainly when nothing is set up, and never throws', async () => {
    const r = await sendStaffNow('2348031234567', 'site_alert', { what: 'x' }, {} as any, recorder().f);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Neither WhatsApp nor SMS/);
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect((await sendStaffNow('1', 'site_alert', { what: 'x' }, SMS, boom)).ok).toBe(false);
  });
});

describe('siteAlert', () => {
  it('sends one message to the alert number and records it in Sentry', async () => {
    const { calls, f } = recorder();
    const r = await siteAlert({ key: 'k1', what: 'Something broke.' }, { ...SMS, SENTRY_DSN: DSN } as any, f, 1_000_000);
    expect(r).toMatchObject({ sent: true, channel: 'sms' });
    expect(calls.some((c) => c.url.includes('termii'))).toBe(true);
    expect(calls.some((c) => c.url.includes('sentry.io'))).toBe(true);
  });
  it('sends the same problem once in 30 minutes, then again after that', async () => {
    const { calls, f } = recorder();
    const t0 = 5_000_000;
    expect((await siteAlert({ key: 'k2', what: 'a' }, SMS, f, t0)).sent).toBe(true);
    expect(await siteAlert({ key: 'k2', what: 'a' }, SMS, f, t0 + 29 * 60_000)).toMatchObject({ sent: false, skipped: 'repeat' });
    expect((await siteAlert({ key: 'k2', what: 'a' }, SMS, f, t0 + 31 * 60_000)).sent).toBe(true);
    expect(calls.filter((c) => c.url.includes('termii'))).toHaveLength(2);
  });
  it('treats different problems separately', async () => {
    const { f } = recorder();
    expect((await siteAlert({ key: 'one', what: 'a' }, SMS, f, 1)).sent).toBe(true);
    expect((await siteAlert({ key: 'two', what: 'b' }, SMS, f, 2)).sent).toBe(true);
  });
  it('honours a longer wait for noisy problems', async () => {
    const { f } = recorder();
    await siteAlert({ key: 'slow', what: 'a', repeatMinutes: 60 }, SMS, f, 0);
    expect((await siteAlert({ key: 'slow', what: 'a', repeatMinutes: 60 }, SMS, f, 45 * 60_000)).skipped).toBe('repeat');
  });
  it('still records in Sentry when there is no alert number', async () => {
    const { calls, f } = recorder();
    const r = await siteAlert({ key: 'k3', what: 'a' }, { SENTRY_DSN: DSN } as any, f);
    expect(r).toMatchObject({ sent: false, skipped: 'no-number' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('sentry.io');
  });
  it('says so (and does not throw) when the number is set but no SMS or WhatsApp is', async () => {
    const r = await siteAlert({ key: 'k4', what: 'a' }, { ALERT_PHONE: '234803' } as any, recorder().f);
    expect(r.sent).toBe(false);
    expect(r.skipped).toBe('no-channel');
  });
  it('never throws, even when everything is offline', async () => {
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const r = await siteAlert({ key: 'k5', what: 'a' }, { ...SMS, SENTRY_DSN: DSN } as any, boom);
    expect(r.sent).toBe(false);
  });
  it('keeps the text to one short line with no secrets', async () => {
    expect(oneLine('a\n\n  b\t c')).toBe('a b c');
    expect(oneLine('x'.repeat(500)).length).toBeLessThanOrEqual(220);
    expect(oneLine('Failed with postgres://user:pass@db.example.com/x and sk_live_abcdef123456')).not.toMatch(/pass@|sk_live/);
    const { calls, f } = recorder();
    await siteAlert({ key: 'k6', what: 'line one\nline two' }, WA, f);
    expect(calls[0].body.template.components[0].parameters[0].text).toBe('line one line two');
  });
});

describe('a payment we could not apply', () => {
  it('names the reference and the reason in plain words', async () => {
    const { calls, f } = recorder();
    const r = await alertPaymentNotApplied('BR-1042-ab12cd34', 'AMOUNT_MISMATCH', SMS, f);
    expect(r.sent).toBe(true);
    const text = calls.find((c) => c.url.includes('termii'))!.body.sms as string;
    expect(text).toContain('BR-1042-ab12cd34');
    expect(text).toContain('the amount paid is not the amount of the order');
  });
  it('has words for each reason', () => {
    expect(paymentProblem('UNKNOWN_REFERENCE')).toMatch(/no order/);
    expect(paymentProblem('ORDER_STATE')).toMatch(/already paid or was cancelled/);
    expect(paymentProblem('STATE')).toMatch(/already paid or was cancelled/);
    expect(paymentProblem('SOMETHING_NEW')).toMatch(/something new/);
  });
  it('is sent once per payment, not once per retry from Paystack', async () => {
    const { calls, f } = recorder();
    await alertPaymentNotApplied('BR-1-x', 'ORDER_STATE', SMS, f);
    await alertPaymentNotApplied('BR-1-x', 'ORDER_STATE', SMS, f);
    await alertPaymentNotApplied('BR-2-y', 'ORDER_STATE', SMS, f);
    expect(calls.filter((c) => c.url.includes('termii'))).toHaveLength(2);
  });
});

describe('the database watch', () => {
  it('stays quiet for a short blip', () => {
    expect(watchDatabase(false, 0)).toBeNull();
    expect(watchDatabase(false, 60_000)).toBeNull();
    expect(watchDatabase(true, 70_000)).toBeNull();
  });
  it('says down after two minutes of failing, and recovered once afterwards', () => {
    expect(watchDatabase(false, 0)).toBeNull();
    expect(watchDatabase(false, 119_000)).toBeNull();
    expect(watchDatabase(false, 121_000)).toBe('down');
    expect(watchDatabase(true, 200_000)).toBe('recovered');
    expect(watchDatabase(true, 210_000)).toBeNull();
  });
  it('starts the clock again after a recovery', () => {
    watchDatabase(false, 0);
    watchDatabase(true, 10_000);
    expect(watchDatabase(false, 200_000)).toBeNull();
    expect(watchDatabase(false, 330_000)).toBe('down');
  });
});

describe('asking Paystack whether a payment went through', () => {
  const env = { PAYSTACK_SECRET_KEY: 'sk_test_x' } as unknown as NodeJS.ProcessEnv;
  const json = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it('reads a paid transaction', async () => {
    const r = await checkWithPaystack('R1', env, json(200, { data: { status: 'success', amount: 150000, channel: 'card' } }));
    expect(r).toMatchObject({ kind: 'paid', amountKobo: 150000, method: 'card' });
  });
  it('treats abandoned and not-yet-started payments as unpaid, not as a fault', async () => {
    expect((await checkWithPaystack('R1', env, json(200, { data: { status: 'abandoned' } }))).kind).toBe('unpaid');
    expect((await checkWithPaystack('R1', env, json(404, { message: 'Transaction reference not found' }))).kind).toBe('unpaid');
  });
  it('reports a real fault as an error', async () => {
    expect((await checkWithPaystack('R1', env, json(401, { message: 'Invalid key' })))).toMatchObject({ kind: 'error' });
    expect((await checkWithPaystack('R1', env, json(500, {}))).kind).toBe('error');
    const down = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
    const r = await checkWithPaystack('R1', env, down);
    expect(r.kind === 'error' && r.message).toMatch(/Could not reach Paystack/);
    expect((await checkWithPaystack('R1', {} as any, json(200, {}))).kind).toBe('error');
  });
});

describe('the Setup page alert test', () => {
  it('tests Sentry and the phone together', async () => {
    const { calls, f } = recorder();
    const r = await testAlert({ ...SMS, SENTRY_DSN: DSN } as any, f);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Open Sentry, Issues/);
    expect(r.message).toMatch(/Test message sent to 2348031234567 by SMS/);
    expect(calls.find((c) => c.url.includes('termii'))!.body.sms).toContain('This is a test');
  });
  it('works with only a phone number', async () => {
    const r = await testAlert(SMS, recorder().f);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/by SMS/);
  });
  it('says what is wrong when the phone message fails', async () => {
    const r = await testAlert(SMS, recorder(() => new Response('bad key', { status: 401 })).f);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/could not be sent/);
    const none = await testAlert({ ALERT_PHONE: '234803' } as any, recorder().f);
    expect(none.ok).toBe(false);
    expect(none.message).toMatch(/neither SMS nor WhatsApp is/);
  });
});
