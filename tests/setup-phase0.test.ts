import { describe, expect, it } from 'vitest';

process.env.PGLITE_DIR = 'memory';
delete process.env.PAYSTACK_SECRET_KEY;

const LIVE = { DEMO_MODE: 'false', NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), NEXT_PUBLIC_APP_URL: 'https://thebrandit.ng' };
const checks = async (extra: Record<string, string> = {}, base: Record<string, string> = LIVE) => {
  const { setupChecks } = await import('../lib/setup');
  const r = await setupChecks({ ...base, ...extra } as any);
  return (id: string) => r.checks.find((c) => c.id === id)!;
};

describe('Setup: the site address', () => {
  it('accepts your own domain', async () => {
    expect((await checks())('url')).toMatchObject({ status: 'ok', detail: 'https://thebrandit.ng' });
  });
  it('warns that onrender.com and vercel.app addresses are temporary, before you share the link', async () => {
    for (const u of ['https://brandit.onrender.com', 'https://brandit-xyz.vercel.app']) {
      const c = (await checks({ NEXT_PUBLIC_APP_URL: u }))('url');
      expect(c.status, u).toBe('warn');
      expect(c.fix).toMatch(/own domain/);
    }
  });
  it('does not nag the test site about its temporary address', async () => {
    expect((await checks({ NEXT_PUBLIC_APP_URL: 'https://brandit-staging.onrender.com', APP_ENV: 'staging' }))('url').status).toBe('ok');
  });
});

describe('Setup: Paystack', () => {
  const withKey = (k: string) => { process.env.PAYSTACK_SECRET_KEY = k; };
  it('is a hard fail when the live site has a TEST key: customers would "pay" and you would get nothing', async () => {
    withKey('sk_test_abc');
    try {
      const c = (await checks({ PAYSTACK_SECRET_KEY: 'sk_test_abc' }))('pay');
      expect(c.status).toBe('bad');
      expect(c.detail).toMatch(/TEST key/);
    } finally { delete process.env.PAYSTACK_SECRET_KEY; }
  });
  it('is a hard fail when the test site has a LIVE key', async () => {
    withKey('sk_live_abc');
    try {
      const c = (await checks({ PAYSTACK_SECRET_KEY: 'sk_live_abc', APP_ENV: 'staging' }))('pay');
      expect(c.status).toBe('bad');
      expect(c.detail).toMatch(/LIVE key/);
    } finally { delete process.env.PAYSTACK_SECRET_KEY; }
  });
  it('is fine with a live key on the live site, and a test key on the test site, and shows the webhook address', async () => {
    withKey('sk_live_abc');
    try {
      const c = (await checks({ PAYSTACK_SECRET_KEY: 'sk_live_abc' }))('pay');
      expect(c.status).toBe('ok');
      expect(c.fix).toContain('https://thebrandit.ng/api/webhooks/paystack');
      withKey('sk_test_abc');
      expect((await checks({ PAYSTACK_SECRET_KEY: 'sk_test_abc', APP_ENV: 'staging' }))('pay').status).toBe('ok');
    } finally { delete process.env.PAYSTACK_SECRET_KEY; }
  });
  it('says what to add when there is no key at all', async () => {
    const c = (await checks())('pay');
    expect(c.status).toBe('bad');
    expect(c.fix).toContain('https://thebrandit.ng/api/webhooks/paystack');
  });
});

describe('Setup: sign-in', () => {
  it('tells you the exact redirect address Google needs, whether or not Google is switched on yet', async () => {
    expect((await checks())('signin-Google').fix).toContain('https://thebrandit.ng/api/auth/google/callback');
  });
  it('points out an email sender that is on a different name from the site', async () => {
    const c = (await checks({ EMAIL_FROM: 'Brandit <hello@gmail.com>' }))('email-domain');
    expect(c).toMatchObject({ status: 'info' });
    expect(c.detail).toContain('gmail.com');
    expect((await checks({ EMAIL_FROM: 'Brandit <hello@thebrandit.ng>' }))('email-domain')).toBeUndefined();
    expect((await checks({ EMAIL_FROM: 'Brandit <hello@mail.thebrandit.ng>' }))('email-domain')).toBeUndefined();
  });
});

describe('Setup: watching the site', () => {
  it('warns on a live site with no error alerts, accepts a good Sentry address, and flags a pasted wrong one', async () => {
    expect((await checks())('errors').status).toBe('warn');
    expect((await checks({ SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/22' }))('errors').status).toBe('ok');
    const bad = (await checks({ SENTRY_DSN: 'abc' }))('errors');
    expect(bad.status).toBe('warn');
    expect(bad.detail).toMatch(/not a Sentry address/);
  });
  it('always reminds you to point an uptime monitor at /api/health', async () => {
    expect((await checks())('uptime').detail).toContain('https://thebrandit.ng/api/health');
  });
});

describe('Setup: the test site', () => {
  it('says it is the test copy and asks for a password', async () => {
    const c = (await checks({ APP_ENV: 'staging' }))('staging');
    expect(c.status).toBe('info');
    expect(c.fix).toMatch(/STAGING_PASSWORD/);
    expect((await checks({ APP_ENV: 'staging', STAGING_PASSWORD: 'x' }))('staging').fix).toBeUndefined();
    expect((await checks())('staging')).toBeUndefined();
  });
});

describe('Setup: the database', () => {
  it('reports a hosted database with its speed, and never its address', async () => {
    const c = (await checks({ DATABASE_URL: 'postgres://u:secretpw@db.example.com/x' }))('db');
    // The test database is the in-memory one, so the query works; the check describes a public address.
    expect(c.detail).not.toMatch(/secretpw|db\.example\.com/);
    expect(['ok', 'warn']).toContain(c.status);
    expect(c.detail).toMatch(/public address|private address/);
  });
  it('on Render, warns when the site is using the public address instead of the private one', async () => {
    const c = (await checks({ RENDER: 'true', DATABASE_URL: 'postgres://u:p@dpg-abc123-a.frankfurt-postgres.render.com/x' }))('db');
    expect(c.status).toBe('warn');
    expect(c.fix).toMatch(/Internal address/);
    const ok = (await checks({ RENDER: 'true', DATABASE_URL: 'postgres://u:p@dpg-abc123-a/x' }))('db');
    expect(ok.status).not.toBe('warn');
    expect(ok.detail).toMatch(/private address/);
  });
});

describe('Setup: your cost sheet (the Phase 1 gate)', () => {
  const REAL = 'active and not provisional and (price_kobo is not null or rate_per_sqft_kobo is not null)';
  it('warns on a live site until every confirmed price has a cost, then says it is loaded', async () => {
    const { query, one } = await import('../lib/db');
    const n0 = await one<{ products: number; priced: number }>(`select (select count(*) from products where active and not sample) as products,
      (select count(distinct r.product_id) from price_rules r join products p on p.id = r.product_id
         where p.active and not p.sample and r.active and not r.provisional and (r.price_kobo is not null or r.rate_per_sqft_kobo is not null)) as priced`);
    // Every product on the live catalogue has at least one real price (the ones you gave us), and none has a cost yet.
    expect(Number(n0?.products)).toBeGreaterThan(0);
    expect(Number(n0?.priced)).toBe(Number(n0?.products));
    await query('update price_rules set cost_kobo = null');
    const c1 = (await checks())('cost-sheet');
    expect(c1.status).toBe('warn');
    expect(c1.detail).toMatch(/0 of \d+ confirmed prices have a cost/);
    expect(c1.detail).toMatch(/margin warnings cannot work yet/);
    expect(c1.fix).toMatch(/Price sheet/);
    // The test site and demo only inform; they never nag.
    expect((await checks({ APP_ENV: 'staging' }))('cost-sheet').status).toBe('info');
    // Partly loaded: still a warning, and it says how far it got.
    await query(`update price_rules set cost_kobo = 100 where id = (select id from price_rules where ${REAL} limit 1)`);
    const c2 = (await checks())('cost-sheet');
    expect(c2.detail).toMatch(/1 of \d+ confirmed prices have a cost/);
    expect(c2.detail).toMatch(/only cover those/);
    // Fully loaded, provided every product on sale has a confirmed price.
    await query(`update price_rules set cost_kobo = 100 where ${REAL}`);
    const c3 = (await checks())('cost-sheet');
    expect(c3.status).toBe('ok');
    expect(c3.detail).toMatch(/Loaded: all \d+ products have confirmed prices/);
    // A placeholder price is not a confirmed price, even with a cost on it.
    await query(`update price_rules set provisional = true where id = (select id from price_rules where ${REAL} limit 1)`);
    const c4 = (await checks())('cost-sheet');
    expect(c4.detail).not.toMatch(new RegExp(`all ${n0?.products} products`));
  });
  it('says plainly that console changes reach the site at once, and shows the last one', async () => {
    const { query } = await import('../lib/db');
    await query('delete from price_history');
    const none = (await checks())('console-change');
    expect(none.status).toBe('info');
    expect(none.detail).toMatch(/No price change has been made yet/);
    await query(`insert into price_history (actor, product_name, kind, summary) values ('Ada', 'Business cards', 'prices', 'Business cards: 2 prices changed.')`);
    const some = (await checks())('console-change');
    expect(some.detail).toMatch(/Business cards: 2 prices changed\. \(Ada, less than an hour ago\)/);
  });
});
