import { query, type Q } from './db';

/*
 * One record of who changed what in the console. It is written by the same code that makes the change, never edited, and
 * it has no foreign keys, so a person who leaves the team does not erase what they did.
 *
 * Price changes have their own, richer record (price_history). The viewer shows both together.
 */
export type Who = { id?: string | null; name: string };
export type AuditArea = 'settings' | 'content' | 'refund' | 'customer' | 'team' | 'catalogue' | 'marketing' | 'order' | 'security' | 'studio';
export const AREA_LABEL: Record<AuditArea, string> = {
  settings: 'Settings', content: 'Words and pages', refund: 'Refunds and payments', customer: 'Customers', team: 'Team', catalogue: 'Catalogue',
  marketing: 'Marketing', order: 'Orders', security: 'Sign-in and security', studio: 'Studio',
};

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Write one line to the record. Never throws: a record that fails to save must not undo the change it describes. */
export async function audit(who: Who, a: { area: AuditArea; action: string; target?: string; summary: string; detail?: Record<string, unknown> }, q?: Pick<Q, 'query'>): Promise<void> {
  try {
    const run = q ? q.query.bind(q) : query;
    await run(
      'insert into audit_log (staff_id, actor, area, action, target, summary, detail) values ($1,$2,$3,$4,$5,$6,$7)',
      [who.id ?? null, short(who.name || 'System', 80), a.area, short(a.action, 60), short(a.target ?? '', 120), short(a.summary, 400), JSON.stringify(a.detail ?? {})],
    );
  } catch (e) {
    console.error('[brandit] could not write to the audit record:', (e as Error)?.message ?? e);
  }
}

export type AuditRow = { at: string; actor: string; area: string; action: string; target: string; summary: string; source: 'audit' | 'price' };

/** The latest entries, newest first. Price changes are included, so the whole story is in one list. */
export async function recentAudit(o: { area?: string; q?: string; limit?: number; offset?: number } = {}): Promise<{ rows: AuditRow[]; more: boolean }> {
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 200);
  const offset = Math.max(o.offset ?? 0, 0);
  const area = o.area && o.area !== 'all' ? o.area : '';
  const like = `%${(o.q ?? '').trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await query<AuditRow>(
    `select * from (
       select at, actor, area, action, target, summary, 'audit'::text as source from audit_log
       union all
       select at, actor, 'catalogue'::text as area, kind as action, product_name as target, summary, 'price'::text as source from price_history
     ) x
     where ($1 = '' or area = $1) and ($2 = '%%' or (actor ilike $2 or summary ilike $2 or target ilike $2 or action ilike $2))
     order by at desc limit $3 offset $4`,
    [area, like, limit + 1, offset],
  );
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}
