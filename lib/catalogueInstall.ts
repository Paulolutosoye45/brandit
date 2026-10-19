import type { Q } from './db';
import { isDemoEnv, isStaging } from './envcheck';
import { CATALOGUE, CATALOGUE_VERSION, cellsFor, materialiseOptions, packProduct, type Cell, type PackProduct } from '../content/catalogue';
import { PRODUCT_CONTENT } from './catalog-content';
import type { OptionChoice, ProductOption } from './types';

/*
 * Putting the catalogue into a database.
 *
 *  - A new database gets every product with its options, packages and price tables. The real site gets only the prices
 *    the shop really has; the demo gets example prices for everything, marked as placeholders.
 *  - An existing database is upgraded once: its products keep their name, photos, text and any price the team has
 *    entered, and gain the new options and tables. Nothing the team typed is thrown away.
 *  - The test site (APP_ENV=staging) can load and clear example prices with a button; the real site never can.
 */

type Db = Pick<Q, 'query'>;

/** Example prices may exist only in the demo and on the private test site. */
export const examplesAllowed = (env: NodeJS.ProcessEnv = process.env) => isDemoEnv(env) || isStaging(env);

const key = (x: { quantity?: number | null; size_key?: string | null; config: Record<string, string> }) =>
  `${x.quantity ?? ''}|${x.size_key ?? ''}|${JSON.stringify(Object.fromEntries(Object.entries(x.config).sort()))}`;

const PRICE_FIELDS = ['extra_kobo', 'extra_per', 'setup_kobo', 'percent', 'by'] as const;

async function insertRule(q: Db, productId: string, c: Cell & { provisional: boolean; active?: boolean }) {
  await q.query(
    `insert into price_rules (product_id, config, quantity, size_key, price_kobo, rate_per_sqft_kobo, min_area_sqft, provisional, active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing`,
    [productId, JSON.stringify(c.config), c.quantity ?? null, c.size_key ?? null, c.price_kobo ?? null, c.rate_per_sqft_kobo ?? null, c.min_area_sqft ?? null, c.provisional, c.active ?? true],
  );
}

async function promiseRow(q: Db, productId: string, p: PackProduct) {
  await q.query(
    `insert into promise_rules (product_id, eligible_24h, max_quantity, max_area_sqft, max_size_rank, excluded_choices, standard_days)
     values ($1,true,$2,$3,$4,$5,3)
     on conflict (product_id) do update set excluded_choices = excluded.excluded_choices,
       max_quantity = coalesce(promise_rules.max_quantity, excluded.max_quantity),
       max_area_sqft = coalesce(promise_rules.max_area_sqft, excluded.max_area_sqft),
       max_size_rank = coalesce(promise_rules.max_size_rank, excluded.max_size_rank)`,
    [productId, p.promise.max_quantity ?? null, p.promise.max_area_sqft ?? null, p.promise.max_size_rank ?? null, JSON.stringify(p.promise.excluded ?? [])],
  );
}

/** A new product row, with its tables. */
async function insertProduct(q: Db, p: PackProduct, sort: number, examples: boolean) {
  const content = PRODUCT_CONTENT[p.slug];
  const [{ id }] = await q.query<{ id: string }>(
    `insert into products (slug, name, blurb, pricing_mode, options, sizes, print_w_in, print_h_in, check_class, sort, description, highlights, category, packages, qty_custom, qty_min, qty_max, personalise)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
    [
      p.slug, p.name, p.blurb, p.mode, JSON.stringify(materialiseOptions(p, examples)), JSON.stringify(p.sizes), p.printW ?? null, p.printH ?? null, p.cls, sort,
      content?.description ?? '', content?.highlights ?? [], content?.category ?? '', JSON.stringify(p.packages), p.qty.custom, p.qty.min, p.qty.max, !!p.personalise,
    ],
  );
  for (const cell of cellsFor(p, examples)) await insertRule(q, id, cell);
  await promiseRow(q, id, p);
  return id;
}

/** Every product, for a database that has none yet. */
export async function installCatalogue(q: Db, opts: { examples: boolean }) {
  let sort = 0;
  for (const p of CATALOGUE) await insertProduct(q, p, sort++, opts.examples && examplesAllowed());
  await q.query("insert into settings (key, value) values ('catalogue_version', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(CATALOGUE_VERSION)]);
}

type OldRule = { quantity: number | null; size_key: string | null; price_kobo: number | null; rate_per_sqft_kobo: number | null; min_area_sqft: number | null; config: Record<string, string>; provisional: boolean; active: boolean };

/** Bring one existing product up to the new catalogue. Returns what happened, for the history. */
async function upgradeProduct(q: Db, p: PackProduct, existing: any, examples: boolean): Promise<{ kept: number; dropped: number; renamed: boolean }> {
  const renamed = existing.slug !== p.slug;
  const content = PRODUCT_CONTENT[p.slug];
  await q.query(
    `update products set slug = $2, pricing_mode = $3, options = $4, sizes = $5, packages = $6, qty_custom = $7, qty_min = $8, qty_max = $9,
       print_w_in = coalesce($10, print_w_in), print_h_in = coalesce($11, print_h_in),
       name = case when $12 then $13 else name end, blurb = case when $12 then $14 else blurb end,
       description = case when $12 then $15 else description end, highlights = case when $12 then $16 else highlights end, category = case when $12 then $17 else category end
     where id = $1`,
    [
      existing.id, p.slug, p.mode, JSON.stringify(materialiseOptions(p, examples)), JSON.stringify(p.sizes), JSON.stringify(p.packages), p.qty.custom, p.qty.min, p.qty.max,
      p.printW ?? null, p.printH ?? null, renamed, p.name, p.blurb, content?.description ?? existing.description ?? '', content?.highlights ?? existing.highlights ?? [], content?.category ?? existing.category ?? '',
    ],
  );

  // Prices the team entered stay; prices invented by an older version do not.
  const old = await q.query<OldRule>('select quantity, size_key, price_kobo, rate_per_sqft_kobo, min_area_sqft::float as min_area_sqft, config, provisional, active from price_rules where product_id = $1', [existing.id]);
  const mapped = new Map<string, Cell & { provisional: boolean; active: boolean }>();
  let dropped = 0;
  for (const r of old) {
    if (r.provisional) { dropped++; continue; }
    const m = p.legacy({ quantity: r.quantity, size_key: r.size_key, price_kobo: r.price_kobo, rate_per_sqft_kobo: r.rate_per_sqft_kobo, config: r.config ?? {} });
    if (!m || (r.price_kobo == null && r.rate_per_sqft_kobo == null)) { dropped++; continue; }
    const cell = {
      quantity: m.quantity ?? undefined, size_key: m.size_key ?? undefined, config: m.config,
      price_kobo: r.price_kobo ?? undefined, rate_per_sqft_kobo: r.rate_per_sqft_kobo ?? undefined, min_area_sqft: r.min_area_sqft ?? undefined,
      provisional: false, active: r.active,
    };
    mapped.set(key(cell), cell);
  }
  for (const cell of cellsFor(p, examples)) if (!mapped.has(key(cell))) mapped.set(key(cell), { ...cell, active: true });
  await q.query('delete from price_rules where product_id = $1', [existing.id]);
  for (const cell of mapped.values()) await insertRule(q, existing.id, cell);
  await promiseRow(q, existing.id, p);
  return { kept: old.length - dropped, dropped, renamed };
}

/**
 * Runs at start-up. Does nothing once the database is on the current catalogue. Safe if two copies of the site start together:
 * one waits for the other and then finds the work done.
 */
export async function upgradeCatalogue(d: { query: Q['query']; tx: <T>(fn: (q: Q) => Promise<T>) => Promise<T> }) {
  const current = async (q: Db) => Number((await q.query<{ value: unknown }>("select value from settings where key = 'catalogue_version'"))[0]?.value ?? 0);
  if ((await current(d)) >= CATALOGUE_VERSION) return;
  const examples = isDemoEnv(process.env);
  await d.tx(async (q) => {
    await q.query('select pg_advisory_xact_lock(7440201)');
    if ((await current(q)) >= CATALOGUE_VERSION) return;
    const rows = await q.query<any>('select * from products where not system');
    const used = new Set<string>();
    let top = rows.reduce((a: number, r: any) => Math.max(a, r.sort ?? 0), 0);
    const report: Record<string, unknown> = {};
    for (const p of CATALOGUE) {
      const hit = rows.find((r: any) => r.slug === p.slug && !used.has(r.id)) ?? rows.find((r: any) => (p.aliases ?? []).includes(r.slug) && !used.has(r.id));
      if (hit) {
        used.add(hit.id);
        report[p.slug] = await upgradeProduct(q, p, hit, examples);
      } else {
        await insertProduct(q, p, ++top, examples);
        report[p.slug] = { added: true };
      }
    }
    await q.query("insert into settings (key, value) values ('catalogue_version', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(CATALOGUE_VERSION)]);
    await q.query(
      "insert into price_history (actor, product_name, kind, summary, detail) values ('system', '', 'catalogue', $1, $2)",
      [`Catalogue version ${CATALOGUE_VERSION} installed: options, packages and price tables added. Prices you had entered were kept.`, JSON.stringify(report)],
    );
  });
}

// ---------- Example prices (the demo and the private test site only) ----------

const exampleChoice = (p: PackProduct, optKey: string, value: string) => p.options.find((o) => o.key === optKey)?.choices.find((c) => c.value === value);

export type ExampleReport = { cells: number; choices: number };

/** Fill every gap with an example price, marked as a placeholder. Prices already entered are never changed. */
export async function loadExamples(d: { query: Q['query']; tx: <T>(fn: (q: Q) => Promise<T>) => Promise<T> }, env: NodeJS.ProcessEnv = process.env): Promise<ExampleReport> {
  if (!examplesAllowed(env)) throw new Error('Example prices can only be loaded on the demo or the private test site.');
  return d.tx(async (q) => {
    const report: ExampleReport = { cells: 0, choices: 0 };
    for (const p of CATALOGUE) {
      const row = (await q.query<any>('select id, options from products where slug = $1 and not system', [p.slug]))[0];
      if (!row) continue;
      const have = new Set((await q.query<any>('select quantity, size_key, config from price_rules where product_id = $1', [row.id])).map((r: any) => key({ quantity: r.quantity, size_key: r.size_key, config: r.config ?? {} })));
      for (const cell of cellsFor(p, true)) {
        if (have.has(key(cell))) continue;
        await insertRule(q, row.id, cell);
        report.cells++;
      }
      let changed = false;
      const options: ProductOption[] = (row.options ?? []).map((o: ProductOption) => ({
        ...o,
        choices: o.choices.map((c: OptionChoice) => {
          if (!c.unpriced) return c;
          const ex = exampleChoice(p, o.key, c.value)?.ex;
          if (!ex) return c;
          changed = true;
          report.choices++;
          const { unpriced: _u, ...rest } = c;
          return { ...rest, ...ex, provisional: true };
        }),
      }));
      if (changed) await q.query('update products set options = $2 where id = $1', [row.id, JSON.stringify(options)]);
    }
    await q.query("insert into price_history (actor, product_name, kind, summary, detail) values ('system', '', 'examples', $1, $2)", [`Example prices filled in: ${report.cells} table prices and ${report.choices} add-on prices. They are placeholders.`, JSON.stringify(report)]);
    return report;
  });
}

/** Take every placeholder price away again, leaving the real ones. Choices that only had an example price go back off the shop. */
export async function clearExamples(d: { query: Q['query']; tx: <T>(fn: (q: Q) => Promise<T>) => Promise<T> }, env: NodeJS.ProcessEnv = process.env): Promise<ExampleReport> {
  if (!examplesAllowed(env)) throw new Error('Example prices can only be cleared on the demo or the private test site.');
  return d.tx(async (q) => {
    const report: ExampleReport = { cells: 0, choices: 0 };
    const gone = await q.query<{ id: string }>('delete from price_rules where provisional returning id');
    report.cells = gone.length;
    for (const row of await q.query<any>('select id, options from products')) {
      let changed = false;
      const options: ProductOption[] = (row.options ?? []).map((o: ProductOption) => ({
        ...o,
        choices: o.choices.map((c: OptionChoice) => {
          if (!c.provisional) return c;
          changed = true;
          report.choices++;
          const rest: any = { ...c };
          for (const f of PRICE_FIELDS) delete rest[f];
          delete rest.provisional;
          return { ...rest, unpriced: true };
        }),
      }));
      if (changed) await q.query('update products set options = $2 where id = $1', [row.id, JSON.stringify(options)]);
    }
    await q.query("insert into price_history (actor, product_name, kind, summary, detail) values ('system', '', 'examples', $1, $2)", [`Example prices cleared: ${report.cells} table prices and ${report.choices} add-on prices removed.`, JSON.stringify(report)]);
    return report;
  });
}

/** How many example prices there are right now (for the console). */
export async function exampleCounts(q: Db): Promise<{ cells: number; choices: number }> {
  const cells = Number((await q.query<{ n: number }>('select count(*)::int as n from price_rules where provisional'))[0]?.n ?? 0);
  let choices = 0;
  for (const row of await q.query<any>('select options from products')) for (const o of row.options ?? []) for (const c of o.choices ?? []) if (c.provisional) choices++;
  return { cells, choices };
}

export { packProduct };
