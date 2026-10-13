import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

process.env.PGLITE_DIR = 'memory';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'shh';
process.env.NEXT_PUBLIC_APP_URL = 'https://brandit.example';

let g: typeof import('../lib/google');
let sess: typeof import('../lib/session');

beforeAll(async () => {
  g = await import('../lib/google');
  sess = await import('../lib/session');
});
afterEach(() => vi.unstubAllGlobals());

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const good = (nonce: string, over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, nonce,
  sub: '1099', email: 'tunde@example.com', email_verified: true, name: 'Tunde Adeyemi', picture: 'https://lh3/x.png', ...over,
});
const stubToken = (body: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));

describe('Sign in with Google', () => {
  it('sends people to Google with PKCE, a state and a nonce, and remembers where they were going', () => {
    const { url, cookie } = g.googleStart('/checkout/abc');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe(process.env.GOOGLE_CLIENT_ID);
    expect(u.searchParams.get('redirect_uri')).toBe('https://brandit.example/api/auth/google/callback');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const c = sess.verify<any>(cookie)!;
    expect(c.next).toBe('/checkout/abc');
    expect(u.searchParams.get('state')).toBe(c.state);
    expect(u.searchParams.get('nonce')).toBe(c.nonce);
    expect(u.searchParams.get('code_challenge')).toBe(createHash('sha256').update(c.verifier).digest('base64url'));
  });

  it('accepts a genuine sign-in and hands back the profile and where to go next', async () => {
    const { cookie } = g.googleStart('/account');
    const c = sess.verify<any>(cookie)!;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id_token: jwt(good(c.nonce)) }) }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await g.googleFinish({ code: 'abc', state: c.state }, cookie);
    expect(r).toEqual({ ok: true, next: '/account', profile: { sub: '1099', email: 'tunde@example.com', name: 'Tunde Adeyemi', picture: 'https://lh3/x.png' } });
    // The code verifier is what proves this is the same browser that started the sign-in.
    const sent = new URLSearchParams(((fetchMock.mock.calls as any)[0][1] as any).body.toString());
    expect(sent.get('code_verifier')).toBe(c.verifier);
    expect(sent.get('grant_type')).toBe('authorization_code');
  });

  const cases: [string, (c: any) => { cookie?: string | null; state?: string; token?: Record<string, unknown>; tokenOk?: boolean }, 'expired' | 'failed'][] = [
    ['no sign-in cookie', () => ({ cookie: null }), 'expired'],
    ['a different state (a forged return)', () => ({ state: 'forged' }), 'expired'],
    ['a different nonce (a replayed token)', (c) => ({ token: good('someone-elses-nonce') }), 'failed'],
    ['a token issued for another app', (c) => ({ token: good(c.nonce, { aud: 'other-app' }) }), 'failed'],
    ['an expired token', (c) => ({ token: good(c.nonce, { exp: Math.floor(Date.now() / 1000) - 5 }) }), 'failed'],
    ['a token from the wrong issuer', (c) => ({ token: good(c.nonce, { iss: 'https://evil.example' }) }), 'failed'],
    ['an unverified email', (c) => ({ token: good(c.nonce, { email_verified: false }) }), 'failed'],
    ['no email at all', (c) => ({ token: good(c.nonce, { email: undefined }) }), 'failed'],
    ['Google refusing the code', () => ({ tokenOk: false }), 'failed'],
  ];
  for (const [name, build, code] of cases) {
    it(`refuses ${name}`, async () => {
      const { cookie } = g.googleStart('/account');
      const c = sess.verify<any>(cookie)!;
      const o = build(c);
      stubToken(o.token ? { id_token: jwt(o.token) } : { error: 'invalid_grant' }, o.tokenOk ?? true);
      const r = await g.googleFinish({ code: 'abc', state: o.state ?? c.state }, o.cookie === null ? undefined : cookie);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(code);
    });
  }

  it('says so plainly when Google cannot be reached', async () => {
    const { cookie } = g.googleStart('/account');
    const c = sess.verify<any>(cookie)!;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const r = await g.googleFinish({ code: 'abc', state: c.state }, cookie);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not reach Google/);
  });

  it('is off until both Google settings exist', () => {
    expect(g.googleOn()).toBe(true);
    const id = process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_ID;
    expect(g.googleOn()).toBe(false);
    process.env.GOOGLE_CLIENT_ID = id;
  });
});
