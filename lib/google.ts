import { createHash, randomBytes } from 'node:crypto';
import { sign, verify } from './session';
import { appUrl } from './messages';

/**
 * Sign in with Google: the standard authorization-code flow with PKCE, written out directly so it
 * needs no extra service. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and add
 * {APP_URL}/api/auth/google/callback as an authorised redirect URI in Google Cloud.
 */
export const googleOn = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const googleRedirectUri = () => `${appUrl()}/api/auth/google/callback`;

const b64 = (b: Buffer) => b.toString('base64url');

export function googleStart(next: string): { url: string; cookie: string } {
  const state = b64(randomBytes(16));
  const nonce = b64(randomBytes(16));
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state, nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, cookie: sign({ state, nonce, verifier, next }, 600) };
}

export type GoogleProfile = { sub: string; email: string; name: string | null; picture: string | null };

/** Check the way back from Google, swap the code for the person's identity, and refuse anything that does not add up. */
export async function googleFinish(p: { code: string | null; state: string | null }, cookie: string | undefined): Promise<{ ok: true; profile: GoogleProfile; next: string } | { ok: false; error: string; code: 'expired' | 'failed' }> {
  const c = verify<{ state: string; nonce: string; verifier: string; next: string }>(cookie);
  if (!c || !p.state || p.state !== c.state) return { ok: false, code: 'expired', error: 'That sign-in link has expired. Start again.' };
  if (!p.code) return { ok: false, code: 'failed', error: 'Google did not send back a sign-in. Start again.' };
  let tokens: any;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: p.code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: googleRedirectUri(), grant_type: 'authorization_code', code_verifier: c.verifier,
      }),
    });
    if (!res.ok) return { ok: false, code: 'failed', error: 'Google would not confirm that sign-in. Try again.' };
    tokens = await res.json();
  } catch {
    return { ok: false, code: 'failed', error: 'We could not reach Google. Check your connection and try again.' };
  }
  // The token came straight from Google over TLS, so we read its claims and check each one that matters.
  let claims: any;
  try { claims = JSON.parse(Buffer.from(String(tokens.id_token).split('.')[1], 'base64url').toString()); } catch { return { ok: false, code: 'failed', error: 'Google sent something we could not read. Try again.' }; }
  const issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!issOk || claims.aud !== process.env.GOOGLE_CLIENT_ID || typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000 || claims.nonce !== c.nonce) {
    return { ok: false, code: 'failed', error: 'That Google sign-in did not check out. Try again.' };
  }
  if (!claims.sub || !claims.email || claims.email_verified !== true) return { ok: false, code: 'failed', error: 'Your Google email is not verified. Use a different way to sign in.' };
  return { ok: true, next: c.next, profile: { sub: String(claims.sub), email: String(claims.email), name: claims.name ?? null, picture: claims.picture ?? null } };
}
