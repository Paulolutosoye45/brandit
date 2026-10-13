import { query } from './db';
import { DEFAULT_SETTINGS, type Settings } from './settings-defaults';

export type { Settings };

/** Settings live in the database so the team can change them without a developer. */
export async function getSettings(): Promise<Settings> {
  const rows = await query<{ key: string; value: unknown }>('select key, value from settings');
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = r.value;
  return applyHostLimits(merged as Settings);
}

/** Vercel refuses any request body over about 4.5 MB, whatever this app allows. Say so honestly (4 MB leaves room for the form around the file). */
export const VERCEL_UPLOAD_MB = 4;
export function applyHostLimits(s: Settings, env: NodeJS.ProcessEnv = process.env): Settings {
  if (env.VERCEL && Number(s.max_upload_mb) > VERCEL_UPLOAD_MB) return { ...s, max_upload_mb: VERCEL_UPLOAD_MB };
  return s;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [key, JSON.stringify(value)]);
}
