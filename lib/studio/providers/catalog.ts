import type { Settings } from '../../settings-defaults';
import type { EngineDef, EngineId } from './types';

/*
 * The engines and their defaults. Model names and prices are only starting points: the console's Studio settings can
 * override both (studio_models, studio_price_overrides), because vendors rename models and change rate cards.
 * Prices are US dollars per picture and were taken from each vendor's public rate card when Studio was built.
 */
export const ENGINES: Record<EngineId, EngineDef> = {
  'recraft-flash': { id: 'recraft-flash', vendor: 'recraft', label: 'Recraft Flash', model: 'recraftv4_flash', usd: 0.007,
    sizes: [[1024, 1024], [1365, 1024], [1024, 1365], [1536, 1024], [1024, 1536], [1820, 1024], [1024, 1820], [2048, 1024], [1024, 2048]] },
  recraft: { id: 'recraft', vendor: 'recraft', label: 'Recraft', model: 'recraftv4', usd: 0.035,
    sizes: [[1024, 1024], [1365, 1024], [1024, 1365], [1536, 1024], [1024, 1536], [1820, 1024], [1024, 1820], [2048, 1024], [1024, 2048]] },
  'recraft-pro': { id: 'recraft-pro', vendor: 'recraft', label: 'Recraft Pro', model: 'recraftv4_pro', usd: 0.21,
    sizes: [[2048, 2048], [2730, 2048], [2048, 2730], [3072, 2048], [2048, 3072]] },
  flux: { id: 'flux', vendor: 'bfl', label: 'FLUX 1.1 Pro', model: 'flux-pro-1.1', usd: 0.04, longSide: 1440 },
  'nano-banana': { id: 'nano-banana', vendor: 'google', label: 'Google Nano Banana Pro', model: 'gemini-3-pro-image-preview', usd: 0.134 },
  'gpt-image': { id: 'gpt-image', vendor: 'openai', label: 'OpenAI GPT Image', model: 'gpt-image-1', usd: 0.19,
    sizes: [[1024, 1024], [1536, 1024], [1024, 1536]] },
};
export const ENGINE_IDS = Object.keys(ENGINES) as EngineId[];
export const isEngineId = (v: unknown): v is EngineId => typeof v === 'string' && v in ENGINES;

/** Per-call prices of the other operations (US dollars). */
export const OP_USD = { vectorise: 0.01, cutout: 0.01, crisp: 0.004, topazPerMp: 0.0033 } as const;

export type Resolved = EngineDef & { model: string; usd: number };

/** An engine with the team's overrides applied. */
export function resolveEngine(id: EngineId, s: Pick<Settings, 'studio_models' | 'studio_price_overrides'>): Resolved {
  const d = ENGINES[id];
  const m = s.studio_models?.[id];
  const p = s.studio_price_overrides?.[id];
  return { ...d, model: typeof m === 'string' && m.trim() ? m.trim() : d.model, usd: typeof p === 'number' && p >= 0 ? p : d.usd };
}
export const opUsd = (key: keyof typeof OP_USD, s: Pick<Settings, 'studio_price_overrides'>) => {
  const p = s.studio_price_overrides?.[key];
  return typeof p === 'number' && p >= 0 ? p : OP_USD[key];
};

export const keyFor = (v: string): string | undefined =>
  ({ recraft: process.env.RECRAFT_API_KEY, bfl: process.env.BFL_API_KEY, google: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY, openai: process.env.OPENAI_API_KEY, fal: process.env.FAL_KEY })[v];

/** Which vendors have a key on this server. */
export const vendorsOn = () => ({
  recraft: !!process.env.RECRAFT_API_KEY, bfl: !!process.env.BFL_API_KEY, google: !!(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY), openai: !!process.env.OPENAI_API_KEY, fal: !!process.env.FAL_KEY,
});
