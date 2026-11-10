/*
 * Keeping Brandit's tables closed to Supabase's public API.
 *
 * Every Supabase project comes with a public web API (the "Data API") and two roles it uses for anyone holding the project's
 * public key: anon and authenticated. Brandit never uses it, but while a table is not locked, that public key could read it:
 * staff PIN hashes, customer names and phones, orders. The fix is "row-level security" on every table with no rules written,
 * which lets nobody through except the owner of the table, which is the login Brandit itself connects with.
 *
 * This runs at every start on a Supabase database (lib/db.ts) and after a restore (scripts/restore.ts), so a table added by a
 * later upgrade is locked too. It also takes away what anon and authenticated were granted on the tables, so that switching
 * row-level security off by hand in Supabase's dashboard would still not open anything. Turn the Data API off as well
 * (Project Settings, Data API): then none of this can be reached at all. SUPABASE-GO-LIVE.md says where.
 */

type Sql = { exec(sql: string): Promise<void>; query(sql: string, params?: unknown[]): Promise<Record<string, any>[]> };

const LOCK_SQL = `
do $$
declare
  r record;
  who text;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity loop
    begin
      execute format('alter table public.%I enable row level security', r.relname);
    exception when insufficient_privilege then null;
    end;
  end loop;
  foreach who in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = who) then
      begin
        execute format('revoke all on all tables in schema public from %I', who);
        execute format('revoke all on all sequences in schema public from %I', who);
        execute format('alter default privileges in schema public revoke all on tables from %I', who);
        execute format('alter default privileges in schema public revoke all on sequences from %I', who);
      exception when insufficient_privilege then null;
      end;
    end if;
  end loop;
end $$;`;

/** Switch on row-level security for every table in the public schema, and take Supabase's public roles' rights away. Safe to repeat. */
export async function lockDownTables(q: Sql): Promise<void> {
  await q.exec(LOCK_SQL);
}

/** The names of the tables in the public schema that are still open (row-level security off). Empty is what you want. */
export async function openTables(q: Sql): Promise<string[]> {
  const rows = await q.query(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1`,
  );
  return rows.map((r) => String(r.name));
}

/** How many tables there are in all, for the line that says "54 of 54 locked". */
export async function tableCount(q: Sql): Promise<number> {
  const r = await q.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')");
  return Number(r[0]?.n ?? 0);
}
