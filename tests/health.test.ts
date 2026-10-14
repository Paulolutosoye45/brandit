import { describe, it, expect, vi, afterAll } from 'vitest';

// A database that refuses every connection, so the start-up and the health check meet a real failure.
vi.stubEnv('DATABASE_URL', 'postgres://u:secretpw@127.0.0.1:1/brandit');
vi.stubEnv('DATABASE_SSL', 'false');
vi.stubEnv('INTERNAL_CRON', 'false');
afterAll(() => vi.unstubAllEnvs());

describe('a database that will not open', () => {
  it('does not crash the server at start-up (a crash shows visitors only a bare 500)', async () => {
    const { startup } = await import('../lib/startup');
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.join(' ')); });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(startup()).resolves.toBeUndefined();
    spy.mockRestore(); log.mockRestore();
    expect(errors.join('\n')).toMatch(/database did not open/);
    expect(errors.join('\n')).toMatch(/\/api\/health/);
  });
  it('makes /api/health say what to do, in plain words, with no address or password', async () => {
    const { GET } = await import('../app/api/health/route');
    const r = await GET();
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body).toMatchObject({ ok: false, db: 'down' });
    expect(body.problem).toMatch(/refused the connection/);
    expect(JSON.stringify(body)).not.toMatch(/secretpw|127\.0\.0\.1/);
  });
});
