import { describe, expect, it } from 'vitest';

// A live site starts by creating its first admin. This once froze the server because the step waited on startup itself.
process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'false';
process.env.SESSION_SECRET = 'a-long-random-secret-for-the-smoke-test-1234567890';
process.env.ADMIN_EMAIL = 'Owner@Brandit.ng';
process.env.ADMIN_PIN = '481926';

describe('starting a live site', () => {
  it('finishes starting, creates only the real admin, and creates no demo staff', async () => {
    const db = await import('../lib/db');
    await Promise.race([db.ready(), new Promise((_, rej) => setTimeout(() => rej(new Error('startup froze')), 20000))]);
    const staff = await db.query<any>('select email, role from staff');
    expect(staff).toEqual([{ email: 'owner@brandit.ng', role: 'admin' }]);
    expect(db.isDemo()).toBe(false);
  }, 30000);
  it('starts again without making a second admin', async () => {
    const db = await import('../lib/db');
    await db.resetForTests();
    await Promise.race([db.ready(), new Promise((_, rej) => setTimeout(() => rej(new Error('startup froze')), 20000))]);
    expect((await db.query<any>("select count(*)::int as n from staff where role = 'admin'"))[0].n).toBe(1);
  }, 30000);
});
