import { one, query, tx } from '../db';
import { getSettings } from '../settings';
import { appUrl } from '../messages';
import { token } from '../password';
import { demoPayments, paystackOn, PaymentsNotConfiguredError } from '../payments';
import { isDemo } from '../db';
import { randomCode } from '../couponCore';
import type { Customer } from '../identity';
import { allowanceFor, priceOf, tierOn, accessFor, type Sku, type Tier } from './config';
import { audit, briefOf, getProject, getVersion, humanCheckNeeded, ownProject, specOf, startFirstRound, type Fail, type Ok, type Project } from './projects';
import { missingRequired } from './prompts';
import { moderateBrief } from './moderation';
import { CATEGORY_MESSAGE } from '../../content/studio-policy';
import { requestVector } from './worker';
import { notifyCredit, notifyRefund, notifyReviewRequested } from './notify';
import { capState } from './ledger';

/*
 * Buying things in Studio. Money rules, in plain words:
 *  - The server decides every price. The browser only says which thing to buy.
 *  - A payment is applied once, however many times Paystack or the customer's browser reports it.
 *  - If what was paid for cannot be made, the money goes back by itself.
 *  - Nothing paid for here expires: pack designs stay in the wallet until used.
 */
export const STUDIO_REF = 'STU-';
export const isStudioRef = (ref: string) => ref.startsWith(STUDIO_REF);

export type Purchase = { id: string; customer_id: string; project_id: string | null; order_id?: string | null; sku: Sku; amount_kobo: number; provider_ref: string; status: 'pending' | 'paid' | 'refunded' | 'failed'; method: string | null; applied_at: string | null; raw: any; created_at: string };

export type BuyIn = { sku: Sku; projectId?: string; versionId?: string };
export type BuyOut = Ok<{ url: string; reference: string; amountKobo: number }> | Ok<{ done: true; projectId: string | null }> | Fail;

async function wallet(customerId: string): Promise<number> {
  const w = await one<{ standard_credits: number }>('select standard_credits from studio_wallets where customer_id = $1', [customerId]);
  return w?.standard_credits ?? 0;
}
export const walletOf = wallet;

/** What buying this sku means for this project, and why not if it can't be. */
export async function checkPurchase(c: Customer, i: BuyIn): Promise<{ ok: true; amount: number; project: Project | null } | Fail> {
  const s = await getSettings();
  const acc = await accessFor(s, c as any);
  if (!acc.ok) return { ok: false, error: acc.message, code: acc.reason };
  const cap = await capState(s);
  if (cap.state === 'all_off') return { ok: false, error: 'Studio is very busy and not taking new designs for a short while. Nothing was charged. Please try again soon.', code: 'busy' };
  const p = i.projectId ? await ownProject(c, i.projectId) : null;
  if (i.sku !== 'pack3' && !p) return { ok: false, error: 'We could not find that design.' };
  if (p && p.status === 'archived') return { ok: false, error: 'This design was closed and refunded.' };
  const need = (t: Tier) => (tierOn(s, t) ? null : `Studio ${t} designs are not available right now.`);
  // Nobody pays before the words are in, the box is ticked and the words pass the content rules. Otherwise money would be taken for a design that cannot be made.
  if (p && (i.sku === 'standard' || i.sku === 'premium')) {
    const brief = briefOf(p);
    const missing = missingRequired(brief);
    if (missing.length) return { ok: false, error: `Fill in: ${missing.join(', ')}.`, code: 'brief' };
    if (!p.consent_at) return { ok: false, error: 'Please tick the box to confirm before we start.', code: 'consent' };
    const mv = moderateBrief({ productSlug: p.product_slug, occasion: brief.occasion, lines: Object.entries(brief.lines).map(([k, text]) => ({ id: k, text })), look: brief.look, extra: s.studio_blocklist_extra });
    if (mv.verdict === 'block') return { ok: false, error: mv.message ?? CATEGORY_MESSAGE.custom, code: 'blocked' };
  }
  if (i.sku === 'standard') {
    if (p!.tier) return { ok: false, error: 'This design is already unlocked.' };
    const off = need('standard'); if (off) return { ok: false, error: off };
    const spec = await specOf(p!, s);
    if ('error' in spec) return { ok: false, error: spec.error };
    if (spec.needsPremium) return { ok: false, error: 'This size needs a Premium design. Choose Premium, or pick a smaller size.', code: 'premium' };
  } else if (i.sku === 'premium') {
    if (p!.tier) return { ok: false, error: p!.tier === 'premium' ? 'This design is already Premium.' : 'Use "Upgrade to Premium" for this design.' };
    const off = need('premium'); if (off) return { ok: false, error: off };
    const spec = await specOf(p!, s);
    if ('error' in spec) return { ok: false, error: spec.error };
  } else if (i.sku === 'upgrade') {
    if (p!.tier !== 'standard') return { ok: false, error: p!.tier === 'premium' ? 'This design is already Premium.' : 'Unlock this design first.' };
    const off = need('premium'); if (off) return { ok: false, error: off };
  } else if (i.sku === 'pack3') {
    const off = need('standard'); if (off) return { ok: false, error: off };
  } else if (i.sku === 'round') {
    if (!p!.tier) return { ok: false, error: 'Unlock this design first.' };
    if (p!.status === 'approved') return { ok: false, error: 'This design is approved. Reopen it to ask for changes.' };
    if (p!.extra_rounds >= 6) return { ok: false, error: 'That is the most extra rounds one design can have. Please contact us and a designer will help.' };
  } else if (i.sku === 'vector') {
    if (p!.tier !== 'standard') return { ok: false, error: p!.tier === 'premium' ? 'Premium designs already include the vector file.' : 'Unlock this design first.' };
    if (p!.vector_paid) return { ok: false, error: 'You already bought the vector file for this design.' };
    const v = i.versionId ? await getVersion(i.versionId) : null;
    if (!v || v.project_id !== p!.id || v.status !== 'ready' || v.kind === 'sketch') return { ok: false, error: 'Choose the design you want as a vector file.' };
  } else if (i.sku === 'check') {
    if (p!.tier !== 'standard') return { ok: false, error: p!.tier === 'premium' ? 'Premium designs already include a check by a Brandit designer.' : 'Unlock this design first.' };
    if (p!.check_paid) return { ok: false, error: 'A check is already included for this design.' };
  } else return { ok: false, error: 'That cannot be bought.' };
  return { ok: true, amount: priceOf(s, i.sku, p?.tier ?? 'standard'), project: p };
}

/** Pay with a design from the pack. No money moves. */
export async function unlockWithPack(c: Customer, projectId: string): Promise<Ok<{ projectId: string }> | Fail> {
  const chk = await checkPurchase(c, { sku: 'standard', projectId });
  if (!chk.ok) return chk;
  const s = await getSettings();
  const used = await one<{ standard_credits: number }>('update studio_wallets set standard_credits = standard_credits - 1 where customer_id = $1 and standard_credits > 0 returning standard_credits', [c.id]);
  if (!used) return { ok: false, error: 'You have no pack designs left.', code: 'no_pack' };
  const ref = `PACK-${token(12)}`;
  const row = await one<Purchase>("insert into studio_purchases (customer_id, project_id, sku, amount_kobo, provider_ref, status, method, verified_at) values ($1,$2,'standard',0,$3,'paid','pack', now()) returning *", [c.id, projectId, ref]);
  await applyPurchase(row!, { fromPack: true });
  void s;
  return { ok: true, projectId };
}

export async function startPurchase(c: Customer, i: BuyIn): Promise<BuyOut> {
  const chk = await checkPurchase(c, i);
  if (!chk.ok) return chk;
  if (!(c.email || c.phone)) return { ok: false, error: 'Sign in with an email or phone number to pay.' };
  const reference = `${STUDIO_REF}${token(14)}`;
  const raw = i.versionId ? { versionId: i.versionId } : {};
  const row = await one<Purchase>(
    "insert into studio_purchases (customer_id, project_id, sku, amount_kobo, provider_ref, status, raw) values ($1,$2,$3,$4,$5,'pending',$6) returning *",
    [c.id, chk.project?.id ?? null, i.sku, chk.amount, reference, JSON.stringify(raw)],
  );
  if (!paystackOn() && !demoPayments()) throw new PaymentsNotConfiguredError();
  if (!paystackOn()) return { ok: true, url: `/studio/pay/${row!.id}?ref=${encodeURIComponent(reference)}`, reference, amountKobo: chk.amount };
  const email = c.email ?? `${(c.phone ?? c.id).replace(/\D/g, '')}@pay.brandit.ng`;
  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount: chk.amount, reference, currency: 'NGN', callback_url: `${appUrl()}/studio/pay/return`, channels: ['card', 'bank_transfer', 'ussd'], metadata: { studio: true, sku: i.sku, project: chk.project?.id ?? null } }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.data?.authorization_url) {
    await query("update studio_purchases set status = 'failed' where id = $1", [row!.id]);
    throw new Error(`Paystack could not start the payment: ${json?.message ?? res.status}`);
  }
  return { ok: true, url: json.data.authorization_url as string, reference, amountKobo: chk.amount };
}

export type ConfirmResult = { ok: true; projectId: string | null; duplicate?: boolean } | { ok: false; reason: 'UNKNOWN_REFERENCE' | 'AMOUNT_MISMATCH' | 'STATE' };

/** Called by the webhook and by the page the customer returns to. Safe to call any number of times. */
export async function confirmStudioPayment(p: { reference: string; amountKobo: number; method?: string; raw?: unknown }): Promise<ConfirmResult> {
  const known = await one<Purchase>('select * from studio_purchases where provider_ref = $1', [p.reference]);
  if (!known) return { ok: false, reason: 'UNKNOWN_REFERENCE' };
  if (known.amount_kobo !== p.amountKobo) return { ok: false, reason: 'AMOUNT_MISMATCH' };
  const claimed = await one<Purchase>(
    "update studio_purchases set status = 'paid', method = $2, verified_at = now(), raw = coalesce(raw, '{}'::jsonb) || $3::jsonb where id = $1 and status = 'pending' returning *",
    [known.id, p.method ?? null, JSON.stringify({ paystack: p.raw ?? null })],
  );
  if (!claimed) {
    if (known.status === 'paid') { await applyPurchase(known).catch(() => {}); return { ok: true, projectId: known.project_id, duplicate: true }; }
    // A late payment on a failed or refunded purchase is flagged for a person. The money is not applied.
    return { ok: false, reason: 'STATE' };
  }
  await applyPurchase(claimed);
  return { ok: true, projectId: claimed.project_id };
}

/** Do what the purchase was for. Runs once: the first caller wins the right to apply it. */
export async function applyPurchase(pu: Purchase, o: { fromPack?: boolean; fromOrder?: boolean } = {}): Promise<void> {
  const first = await one('update studio_purchases set applied_at = now() where id = $1 and applied_at is null returning id', [pu.id]);
  if (!first) return;
  const s = await getSettings();
  try {
    const projectId = pu.project_id;
    if (pu.sku === 'pack3') {
      await query('insert into studio_wallets (customer_id, standard_credits) values ($1, 3) on conflict (customer_id) do update set standard_credits = studio_wallets.standard_credits + 3', [pu.customer_id]);
      await audit(null, `customer:${pu.customer_id}`, 'pack_bought', { purchase: pu.id });
      return;
    }
    if (!projectId) return;
    const proj = await getProject(projectId);
    if (!proj) return;
    if (pu.sku === 'standard' || pu.sku === 'premium') {
      const tier: Tier = pu.sku;
      await query("update studio_projects set tier = $2, status = 'active', paid_kobo = paid_kobo + $3, paid_at = now(), from_pack = $4, credit_kobo = $5 where id = $1", [projectId, tier, pu.amount_kobo, !!o.fromPack, o.fromOrder ? 0 : allowanceFor(tier, s).creditKobo]);
      await audit(projectId, `customer:${pu.customer_id}`, 'unlocked', { tier, amount: pu.amount_kobo, pack: !!o.fromPack, order: !!o.fromOrder });
      await startFirstRound(projectId);
    } else if (pu.sku === 'upgrade') {
      await query("update studio_projects set tier = 'premium', paid_kobo = paid_kobo + $2, credit_kobo = $3 where id = $1", [projectId, pu.amount_kobo, allowanceFor('premium', s).creditKobo]);
      await audit(projectId, `customer:${pu.customer_id}`, 'upgraded', { amount: pu.amount_kobo });
      await topUpDrafts(projectId);
    } else if (pu.sku === 'round') {
      await query('update studio_projects set extra_rounds = extra_rounds + 1, paid_kobo = paid_kobo + $2 where id = $1', [projectId, pu.amount_kobo]);
      await audit(projectId, `customer:${pu.customer_id}`, 'round_bought', { amount: pu.amount_kobo });
    } else if (pu.sku === 'vector') {
      await query('update studio_projects set vector_paid = true, paid_kobo = paid_kobo + $2 where id = $1', [projectId, pu.amount_kobo]);
      await audit(projectId, `customer:${pu.customer_id}`, 'vector_bought', { amount: pu.amount_kobo });
      const vid = pu.raw?.versionId as string | undefined;
      if (vid) await requestVector(projectId, vid);
    } else if (pu.sku === 'check') {
      await query('update studio_projects set check_paid = true, paid_kobo = paid_kobo + $2 where id = $1', [projectId, pu.amount_kobo]);
      await audit(projectId, `customer:${pu.customer_id}`, 'check_bought', { amount: pu.amount_kobo });
      const p2 = await getProject(projectId);
      if (p2 && p2.status === 'approved' && humanCheckNeeded(p2)) {
        const has = await one('select 1 as x from studio_reviews where project_id = $1 and version_id = $2', [projectId, p2.approved_version_id]);
        if (!has && p2.approved_version_id) {
          await query('insert into studio_reviews (project_id, version_id) values ($1,$2)', [projectId, p2.approved_version_id]);
          await notifyReviewRequested(projectId).catch(() => {});
        }
      }
    }
  } catch (e) {
    // Leave it to be applied again by the sweep. The money is safe either way.
    await query('update studio_purchases set applied_at = null where id = $1', [pu.id]);
    throw e;
  }
}

/** Premium after an upgrade: bring the number of first-round designs up to what Premium includes. */
async function topUpDrafts(projectId: string) {
  const s = await getSettings();
  const p = await getProject(projectId);
  if (!p) return;
  const spec = await specOf(p, s);
  if ('error' in spec) return;
  const have = await one<{ n: string }>("select count(*) as n from studio_versions where project_id = $1 and kind in ('concept','draft') and status in ('queued','running','ready')", [projectId]);
  const need = allowanceFor('premium', s).concepts - Number(have?.n ?? 0);
  if (need <= 0) return;
  const { normaliseBrief, defaultBrief } = await import('./prompts');
  const brief = normaliseBrief(p.brief, defaultBrief(p.occasion));
  const photo = await one<{ id: string }>("select id from studio_assets where project_id = $1 and kind = 'photo' order by created_at desc limit 1", [projectId]);
  const logo = await one<{ id: string }>("select id from studio_assets where project_id = $1 and kind = 'logo' order by created_at desc limit 1", [projectId]);
  const base = Number((await one<{ n: string }>("select count(*) as n from studio_versions where project_id = $1 and kind in ('concept','draft')", [projectId]))?.n ?? 0);
  for (let i = 0; i < need; i++) {
    await query(
      `insert into studio_versions (project_id, kind, idx, seed, layout, payload, spec, delete_after) values ($1,'draft',$2,$3,$4,$5,$6,$7)`,
      [projectId, base + i, 1 + Math.floor(Math.random() * 2_000_000_000), JSON.stringify({ brief, paletteId: brief.palette }), JSON.stringify({ variation: base + i, photo_asset: photo?.id ?? null, logo_asset: logo?.id ?? null }), JSON.stringify(spec), p.delete_after],
    );
  }
  const { kick } = await import('./worker');
  kick();
}

/** Payments that were confirmed but not applied (a crash in between). Run by the sweep. */
export async function applyPendingPaid(limit = 20): Promise<number> {
  const rows = await query<Purchase>("select * from studio_purchases where status = 'paid' and applied_at is null and verified_at < now() - interval '1 minute' order by created_at limit $1", [limit]);
  let n = 0;
  for (const r of rows) { try { await applyPurchase(r, { fromPack: r.method === 'pack', fromOrder: r.method === 'order' }); n++; } catch (e) { console.error(`[brandit] studio apply ${r.id} failed: ${(e as Error)?.message ?? e}`); } }
  return n;
}

// ---------- Refunds ----------
async function sendRefund(pu: Purchase, amountKobo: number): Promise<{ ok: boolean; error?: string }> {
  if (pu.method === 'pack' || amountKobo <= 0) return { ok: true };
  // A design paid inside an order went back through the order's own payment.
  if (pu.method === 'order' && pu.order_id) {
    const { refundPayment } = await import('../payments');
    const r = await refundPayment(pu.order_id, amountKobo, `studio-${pu.id}`, { reason: 'Studio design could not be made' });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  if (!paystackOn() && !isDemo()) return { ok: false, error: 'Payments are not set up, so this refund cannot be sent.' };
  if (paystackOn()) {
    const res = await fetch('https://api.paystack.co/refund', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: pu.provider_ref, amount: amountKobo }),
    });
    if (!res.ok) return { ok: false, error: `Paystack refused the refund (${res.status}).` };
  }
  return { ok: true };
}

/** Give one purchase back. A pack design goes back in the wallet instead of becoming money. */
export async function refundPurchase(purchaseId: string, note: string, o: { notify?: boolean } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const pu = await one<Purchase>('select * from studio_purchases where id = $1', [purchaseId]);
  if (!pu) return { ok: false, error: 'Purchase not found.' };
  if (pu.status !== 'paid') return { ok: false, error: pu.status === 'refunded' ? 'Already refunded.' : 'This purchase was not paid.' };
  const sent = await sendRefund(pu, pu.amount_kobo);
  if (!sent.ok) return { ok: false, error: sent.error ?? 'Refund failed.' };
  const done = await one('update studio_purchases set status = $2, refunded_at = now(), refund_note = $3 where id = $1 and status = $4 returning id', [pu.id, 'refunded', note.slice(0, 300), 'paid']);
  if (!done) return { ok: true };
  if (pu.method === 'pack') await query('insert into studio_wallets (customer_id, standard_credits) values ($1,1) on conflict (customer_id) do update set standard_credits = studio_wallets.standard_credits + 1', [pu.customer_id]);
  if (pu.sku === 'pack3') await query('update studio_wallets set standard_credits = greatest(0, standard_credits - 3) where customer_id = $1', [pu.customer_id]);
  if (pu.project_id) {
    const col: Record<string, string> = { round: 'extra_rounds = greatest(0, extra_rounds - 1)', vector: 'vector_paid = false', check: 'check_paid = false' };
    if (col[pu.sku]) await query(`update studio_projects set ${col[pu.sku]}, paid_kobo = greatest(0, paid_kobo - $2) where id = $1`, [pu.project_id, pu.amount_kobo]);
    await audit(pu.project_id, 'system', 'refunded', { purchase: pu.id, sku: pu.sku, amount: pu.amount_kobo, note });
    if (o.notify !== false) await notifyRefund(pu.project_id, pu.amount_kobo, note).catch(() => {});
  }
  return { ok: true };
}

/** Everything bought for a design that could not be made. The design is closed. */
export async function refundProject(projectId: string, note: string): Promise<void> {
  const rows = await query<Purchase>("select * from studio_purchases where project_id = $1 and status = 'paid' order by created_at", [projectId]);
  for (const r of rows) {
    const out = await refundPurchase(r.id, note, { notify: false });
    if (!out.ok) console.error(`[brandit] studio refund ${r.id} failed: ${out.error}`);
  }
  await query("update studio_projects set status = 'archived', paid_kobo = 0 where id = $1 and status <> 'purged'", [projectId]);
  // A design that was paid for inside an order leaves the print line needing the customer's own file.
  await (await import('./inOrder')).releasePaidLine(projectId).catch((e) => console.error('[brandit] could not release the order line:', e?.message ?? e));
  const total = rows.reduce((n, r) => n + r.amount_kobo, 0);
  if (total > 0) await notifyRefund(projectId, total, note).catch(() => {});
  else await notifyRefund(projectId, 0, note).catch(() => {});
}

/** One kind of purchase on a design, like a vector file that failed. */
export async function refundSku(projectId: string, sku: Sku, note: string): Promise<void> {
  const r = await one<Purchase>("select * from studio_purchases where project_id = $1 and sku = $2 and status = 'paid' order by created_at desc limit 1", [projectId, sku]);
  if (r) await refundPurchase(r.id, note);
}

// ---------- The print credit ----------
/** A code that takes the credit off the print order for this design. Made once, valid for the days in settings. */
export async function ensureCredit(projectId: string): Promise<{ code: string; id: string } | null> {
  const p = await getProject(projectId);
  if (!p || p.status !== 'approved' || !(p.credit_kobo > 0)) return null;
  if (p.credit_coupon_id) {
    const c = await one<{ id: string; code: string; active: boolean }>('select id, code, active from coupons where id = $1', [p.credit_coupon_id]);
    if (c) return { id: c.id, code: c.code };
  }
  const s = await getSettings();
  const prod = await one<{ id: string }>('select id from products where slug = $1', [p.product_slug]);
  const ends = new Date((p.approved_at ? new Date(p.approved_at).getTime() : Date.now()) + s.studio_credit_days * 86_400_000).toISOString();
  for (let i = 0; i < 6; i++) {
    const code = randomCode('STUDIO');
    const row = await one<{ id: string; code: string }>(
      `insert into coupons (code, description, kind, amount_off_kobo, min_subtotal_kobo, max_redemptions, max_per_customer, first_order_only, product_ids, active, source, owner_customer_id, ends_at)
       values ($1,$2,'fixed',$3,0,1,1,false,$4::uuid[],true,'reward',$5,$6) on conflict do nothing returning id, code`,
      [code, 'Brandit Studio design credit', p.credit_kobo, prod ? `{${prod.id}}` : '{}', p.customer_id, ends],
    );
    if (row) {
      await query('update studio_projects set credit_coupon_id = $2 where id = $1', [projectId, row.id]);
      await audit(projectId, 'system', 'credit_issued', { code: row.code, kobo: p.credit_kobo, ends });
      await notifyCredit(projectId, p.credit_kobo, s.studio_credit_days).catch(() => {});
      return row;
    }
  }
  return null;
}

/** When a design is reopened, its unused credit code stops working until it is approved again. */
export async function pauseCredit(projectId: string) {
  const p = await getProject(projectId);
  if (p?.credit_coupon_id) await query('update coupons set active = false where id = $1', [p.credit_coupon_id]);
}
export async function resumeCredit(projectId: string) {
  const p = await getProject(projectId);
  if (p?.credit_coupon_id) await query('update coupons set active = true where id = $1', [p.credit_coupon_id]);
}

export async function purchasesOf(customerId: string) {
  return query<Purchase & { title: string | null }>(
    'select pu.*, p.title from studio_purchases pu left join studio_projects p on p.id = pu.project_id where pu.customer_id = $1 and pu.status in (\'paid\',\'refunded\') order by pu.created_at desc limit 50',
    [customerId],
  );
}
void tx;
