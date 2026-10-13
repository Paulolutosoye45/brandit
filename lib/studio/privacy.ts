import { one, query } from '../db';
import { purgeProject } from './projects';

/** Everything Studio holds about a customer, for the "download my data" file. Pictures are not inlined: they are described. */
export async function exportStudio(customerId: string) {
  const projects = await query<any>(
    `select id, title, tier, status, product_slug, size_key, quantity, occasion, brief, approved_at, spelling_confirmed_at, created_at, delete_after
       from studio_projects where customer_id = $1 order by created_at`, [customerId]);
  const assets = await query<any>('select project_id, kind, title, mime, bytes, width_px, height_px, created_at from studio_assets where customer_id = $1 order by created_at', [customerId]);
  const purchases = await query<any>('select sku, amount_kobo, status, method, created_at, refunded_at from studio_purchases where customer_id = $1 order by created_at', [customerId]);
  const wallet = await one<any>('select standard_credits from studio_wallets where customer_id = $1', [customerId]);
  const feedback = await query<any>('select f.name, f.verdict, f.note, f.created_at from studio_feedback f join studio_projects p on p.id = f.project_id where p.customer_id = $1 order by f.created_at', [customerId]);
  const flags = await query<any>('select stage, category, verdict, created_at from studio_flags where customer_id = $1 order by created_at', [customerId]);
  return {
    note: 'Designs made with Brandit Studio. The pictures themselves are kept for the retention period and then deleted. Words are the text you typed.',
    projects, uploaded_pictures: assets, purchases, saved_pack_designs: wallet?.standard_credits ?? 0, comments_from_share_link: feedback, stopped_requests: flags,
  };
}

/**
 * Erase Studio data for a person. Words, pictures and designs go (the files too). Payment records stay with no one attached
 * because accounts must be kept. Unused pack designs end with the account.
 */
export async function eraseStudio(customerId: string) {
  const ps = await query<{ id: string }>("select id from studio_projects where customer_id = $1 and status <> 'purged'", [customerId]);
  for (const p of ps) await purgeProject(p.id, 'account_deleted');
  await query("update studio_projects set title = '', share_token = replace(gen_random_uuid()::text, '-', '') where customer_id = $1", [customerId]);
  await query('delete from studio_wallets where customer_id = $1', [customerId]);
  await query('delete from studio_sketch_log where customer_id = $1', [customerId]);
  await query('update studio_flags set excerpt = null where customer_id = $1', [customerId]);
  await query('delete from studio_assets where customer_id = $1', [customerId]);
}
