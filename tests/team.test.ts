import { beforeAll, describe, expect, it } from 'vitest';

process.env.PGLITE_DIR = 'memory';
let t: typeof import('../lib/team');
let db: typeof import('../lib/db');
beforeAll(async () => { t = await import('../lib/team'); db = await import('../lib/db'); await db.ready(); });

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('staff PINs', () => {
  it('accepts a good PIN', () => { expect(t.validatePin('482915')).toBeNull(); expect(t.validatePin('73920164')).toBeNull(); });
  it('refuses short, long, non-numeric and easy PINs', () => {
    for (const bad of ['1234', '12345', '1234567890123', 'abcdef', '12 3456', '111111', '123456', '654321', '234567', '000000', '121212']) expect(t.validatePin(bad), bad).not.toBeNull();
  });
});

describe('the team', () => {
  it('adds a person, hashes their PIN, and lets them be found', async () => {
    const r = await t.addStaff({ name: ' Kemi   Bello ', email: 'Kemi@Brandit.NG', role: 'file_desk', pin: '482915' });
    expect(r).toEqual({ ok: true });
    const row = (await db.one<any>("select * from staff where email = 'kemi@brandit.ng'"))!;
    expect(row).toMatchObject({ name: 'Kemi Bello', role: 'file_desk', active: true });
    expect(row.pin_hash).not.toContain('482915');
  });
  it('says which field is wrong', async () => {
    expect(await t.addStaff({ name: 'K', email: 'k@x.com', role: 'support', pin: '482915' })).toMatchObject({ ok: false, field: 'name' });
    expect(await t.addStaff({ name: 'Kemi', email: 'nope', role: 'support', pin: '482915' })).toMatchObject({ ok: false, field: 'email' });
    expect(await t.addStaff({ name: 'Kemi', email: 'k2@x.com', role: 'chief', pin: '482915' })).toMatchObject({ ok: false, field: 'role' });
    expect(await t.addStaff({ name: 'Kemi', email: 'k3@x.com', role: 'support', pin: '123456' })).toMatchObject({ ok: false, field: 'pin' });
    expect(await t.addStaff({ name: 'Kemi', email: 'kemi@brandit.ng', role: 'support', pin: '482915' })).toMatchObject({ ok: false, field: 'email' });
  });
  it('needs a printing partner for a partner-press login', async () => {
    expect(await t.addStaff({ name: 'Press Person', email: 'press1@x.com', role: 'partner_press', pin: '482915' })).toMatchObject({ ok: false, field: 'press' });
    expect(await t.addPress('Surulere Digital Press', true)).toEqual({ ok: true });
    const press = (await t.listPresses()).find((p) => p.name === 'Surulere Digital Press')!;
    expect(await t.addStaff({ name: 'Press Person', email: 'press1@x.com', role: 'partner_press', pin: '482915', pressId: press.id })).toEqual({ ok: true });
    expect(await t.addPress('surulere digital press', true)).toMatchObject({ ok: false });
  });
  it('never leaves the site with no admin, and never lets you switch yourself off', async () => {
    const admins = await db.query<any>("select id from staff where role = 'admin' and active");
    for (const a of admins.slice(1)) await t.setStaffActive(a.id, false, admins[0].id);
    const only = admins[0].id;
    const other = (await db.one<any>("select id from staff where email = 'kemi@brandit.ng'"))!.id;
    expect(await t.setStaffActive(only, false, other)).toMatchObject({ ok: false, error: expect.stringMatching(/at least one active admin/) });
    expect(await t.setRole(only, 'support', null)).toMatchObject({ ok: false, error: expect.stringMatching(/at least one active admin/) });
    expect(await t.setStaffActive(only, false, only)).toMatchObject({ ok: false, error: expect.stringMatching(/yourself/) });
    expect(await t.setRole(other, 'dispatcher', null)).toEqual({ ok: true });
    expect(await t.setStaffActive(other, false, only)).toEqual({ ok: true });
    expect(await t.setStaffActive(other, true, only)).toEqual({ ok: true });
  });
  it('resets a PIN and changes your own only with the current one', async () => {
    const id = (await db.one<any>("select id from staff where email = 'kemi@brandit.ng'"))!.id;
    expect(await t.resetPin(id, '1234')).toMatchObject({ ok: false });
    expect(await t.resetPin(id, '739201')).toEqual({ ok: true });
    expect(await t.changeOwnPin(id, '000111', '582913')).toMatchObject({ ok: false, field: 'current' });
    expect(await t.changeOwnPin(id, '739201', '739201')).toMatchObject({ ok: false, field: 'next' });
    expect(await t.changeOwnPin(id, '739201', '555555')).toMatchObject({ ok: false, field: 'next' });
    expect(await t.changeOwnPin(id, '739201', '582913')).toEqual({ ok: true });
    expect((await t.changeOwnPin(id, '739201', '582913')).ok).toBe(false);
  });
});

describe('the first admin', () => {
  it('is created from the environment when there is none, and never twice', async () => {
    await db.query("update staff set active = false where role = 'admin'");
    expect(await t.ensureAdmin(env({ ADMIN_EMAIL: 'Owner@Brandit.ng', ADMIN_PIN: '481926' }))).toBe('created');
    expect(await t.ensureAdmin(env({ ADMIN_EMAIL: 'owner@brandit.ng', ADMIN_PIN: '481926' }))).toBe('present');
    expect((await db.one<any>("select count(*)::int as n from staff where email = 'owner@brandit.ng'"))!.n).toBe(1);
  });
  it('is created for the owner even when other admins exist, and never resets an existing PIN', async () => {
    expect(await t.ensureAdmin(env({ ADMIN_EMAIL: 'second.owner@brandit.ng', ADMIN_PIN: '583920' }))).toBe('created');
    const before = (await db.one<any>("select pin_hash from staff where email = 'second.owner@brandit.ng'"))!.pin_hash;
    expect(await t.ensureAdmin(env({ ADMIN_EMAIL: 'second.owner@brandit.ng', ADMIN_PIN: '640271' }))).toBe('present');
    expect((await db.one<any>("select pin_hash from staff where email = 'second.owner@brandit.ng'"))!.pin_hash).toBe(before);
  });
  it('refuses a weak PIN and does nothing without settings', async () => {
    expect(await t.ensureAdmin(env({ ADMIN_EMAIL: 'x@y.com', ADMIN_PIN: '1234' }))).toBe('weak-pin');
    expect(await t.ensureAdmin(env({}))).toBe('skipped');
  });
});
