/*
 * An order is a basket of one or more lines. These are the small shared pieces that say it in words,
 * so every page and message describes a basket the same way.
 */

/** SQL: "Business cards × 100", or "Business cards × 100 + 2 more" when the order has several lines. `o` is the orders alias. */
export const summarySql = (o = 'o') =>
  `(select case when count(*) > 1
                then (array_agg(coalesce(i.label, p.name) || ' × ' || i.quantity order by i.position, i.id))[1] || ' + ' || (count(*) - 1) || ' more'
                else max(coalesce(i.label, p.name) || ' × ' || i.quantity) end
      from order_items i join products p on p.id = i.product_id where i.order_id = ${o}.id)`;

/** SQL: the name of the first line, or "Business cards + 2 more". */
export const nameSql = (o = 'o') =>
  `(select case when count(*) > 1
                then (array_agg(coalesce(i.label, p.name) order by i.position, i.id))[1] || ' + ' || (count(*) - 1) || ' more'
                else max(coalesce(i.label, p.name)) end
      from order_items i join products p on p.id = i.product_id where i.order_id = ${o}.id)`;

/** SQL: how many lines the order has. */
export const countSql = (o = 'o') => `(select count(*)::int from order_items i where i.order_id = ${o}.id)`;

/** "Business cards × 100" for one line. */
export const lineSummary = (name: string, quantity: number, extra?: string | null) => `${name} × ${quantity.toLocaleString('en-US')}${extra ? ` (${extra})` : ''}`;

/** The same words for a list of lines already in memory. */
export function basketSummary(lines: { name: string; quantity: number }[]): string {
  if (lines.length === 0) return 'Nothing yet';
  const first = `${lines[0].name} × ${lines[0].quantity.toLocaleString('en-US')}`;
  return lines.length === 1 ? first : `${first} + ${lines.length - 1} more`;
}

/** What a customer sees next to a line about its artwork and proof. One word for each state. */
export type ProofState = 'needs_file' | 'file_later' | 'sample' | 'checked' | 'designer' | 'studio' | 'studio_making' | 'approved_preview' | 'proof_waiting' | 'proof_approved' | 'printing' | 'done';

export function proofLabel(s: ProofState): string {
  switch (s) {
    case 'needs_file': return 'Needs your file';
    case 'file_later': return 'You send the file after paying';
    case 'sample': return 'No artwork needed';
    case 'checked': return 'File checked';
    case 'designer': return 'Designer will make it';
    case 'studio': return 'Studio design added';
    case 'studio_making': return 'Studio is making your design'
    case 'approved_preview': return 'You approved the preview';
    case 'proof_waiting': return 'Proof waiting for you';
    case 'proof_approved': return 'Proof approved';
    case 'printing': return 'Printing';
    case 'done': return 'Finished';
  }
}

/**
 * Where a line stands on artwork, before and after payment. Before payment it is about whether the customer is ready to pay.
 * After payment it follows the job.
 */
export function proofStateOf(line: { artwork_path: string | null; preview_approved_at: unknown; artwork_file_id: unknown; studio_tier?: string | null; design_brief?: unknown }, job?: { stage: string } | null): ProofState {
  const kind = noFileKind(line);
  if (kind === 'sample') return job?.stage === 'delivered' ? 'done' : job && ['printing', 'quality_check', 'out_for_delivery'].includes(job.stage) ? 'printing' : 'sample';
  if (kind === 'file_later' && !line.artwork_file_id) return job ? (job.stage === 'delivered' ? 'done' : 'needs_file') : 'file_later';
  if (job) {
    if (job.stage === 'delivered') return 'done';
    if (line.artwork_path === 'studio') return 'studio_making';
    if (['printing', 'quality_check', 'out_for_delivery'].includes(job.stage)) return 'printing';
    if (job.stage === 'proof') return 'proof_waiting';
    if (line.artwork_path === 'design') return line.preview_approved_at ? 'proof_approved' : 'designer';
    return line.preview_approved_at ? 'approved_preview' : 'checked';
  }
  if (line.artwork_path === 'design') return 'designer';
  if (line.artwork_path === 'studio' && line.studio_tier) return 'studio';
  if (line.artwork_path === 'upload' && line.preview_approved_at && line.artwork_file_id) return 'approved_preview';
  if (line.artwork_path === 'upload' && line.artwork_file_id) return 'checked';
  return 'needs_file';
}

/** Is this line ready to be paid for? A file the customer approved, or a designer asked for. */
export const lineReady = (line: { artwork_path: string | null; preview_approved_at: unknown; studio_tier?: string | null; design_brief?: unknown }) =>
  line.artwork_path === 'design' || (line.artwork_path === 'studio' && !!line.studio_tier) || (line.artwork_path === 'upload' && !!line.preview_approved_at) || noFileKind(line) !== null;

/**
 * A line that can be paid for with no artwork yet.
 *  - 'sample': the sample pack, which has nothing to print.
 *  - 'file_later': a line staff built from a WhatsApp chat, where the customer sends the file after paying.
 * Both are marked on the line itself, so the checkout, the pay link and the job screens all read the same fact.
 */
export function noFileKind(line: { artwork_path?: string | null; design_brief?: unknown }): 'sample' | 'file_later' | null {
  if (line.artwork_path !== 'upload') return null;
  const k = (line.design_brief as { kind?: unknown } | null | undefined)?.kind;
  return k === 'sample' || k === 'file_later' ? k : null;
}

/** Does this line still need the customer to deal with its artwork before the order can be paid? */
export function artworkOutstanding(l: { artwork_path: string | null; preview_approved_at: unknown; artwork_file_id: unknown; studio_tier?: string | null; design_brief?: unknown }): boolean {
  if (noFileKind(l)) return false;
  if (!l.artwork_path) return true;
  if (l.artwork_path === 'upload') return !l.preview_approved_at || !l.artwork_file_id;
  if (l.artwork_path === 'studio') return !l.studio_tier;
  return false;
}
