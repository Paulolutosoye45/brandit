import { query } from './db';
import { DEFAULT_SETTINGS, type Settings } from './settings-defaults';

export type { Settings };

/** Settings live in the database so the team can change them without a developer. */
export async function getSettings(): Promise<Settings> {
  const rows = await query<{ key: string; value: unknown }>('select key, value from settings');
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = r.value;
  return merged as Settings;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [key, JSON.stringify(value)]);
}
