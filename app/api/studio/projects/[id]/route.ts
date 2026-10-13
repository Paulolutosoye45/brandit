import { NextResponse } from 'next/server';
import { one } from '@/lib/db';
import {
  approve, changeSpec, chooseLiked, deleteProject, getProject, getVersion, ownProject, reopen, requestAdapt, requestChange, requestFinish, requestPremiumFinal, requestSketch, saveBrief, setConsent, setShared, tweak,
} from '@/lib/studio/projects';
import { unlockWithPack } from '@/lib/studio/purchases';
import { startOrder } from '@/lib/studio/attach';
import { kick, requestVector } from '@/lib/studio/worker';
import { projectView } from '@/lib/studio/view';
import { bad, customerOr401, good, jsonBody, openOr403, STUDIO_ID } from '@/lib/studio/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** The design as the page needs it. The page asks again every few seconds while work is waiting, and that also keeps the queue moving. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!STUDIO_ID.test(id)) return bad('Not found', 404);
  const who = await customerOr401(req, 'view', 240);
  if ('res' in who) return who.res;
  const view = await projectView(who.c, id);
  if (!view) return bad('We could not find that design.', 404);
  if (view.working) kick();
  return NextResponse.json({ ok: true, view }, { headers: { 'Cache-Control': 'no-store' } });
}

const fail = (r: { error: string; code?: string; field?: string; extra?: Record<string, unknown> }) =>
  bad(r.error, r.code === 'signin' ? 401 : r.code === 'off' || r.code === 'invite' || r.code === 'paused' ? 403 : 422, { code: r.code, field: r.field, ...(r.extra ?? {}) });

/** Everything a customer can do to their design. One door, so every action passes the same checks. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!STUDIO_ID.test(id)) return bad('Not found', 404);
  const who = await customerOr401(req, 'act', 90);
  if ('res' in who) return who.res;
  const c = who.c;
  const b = await jsonBody(req);
  if (!b) return bad('Something went wrong. Try again.');
  const action = String(b.action ?? '');
  const p = await ownProject(c, id);
  if (!p) return bad('We could not find that design.', 404);

  switch (action) {
    case 'brief': {
      const r = await saveBrief(c, id, b.brief);
      return r.ok ? good({ brief: r.brief, warnings: r.warnings }) : fail(r);
    }
    case 'consent': {
      const closed = await openOr403(c);
      if (closed) return closed;
      return (await setConsent(c, id)) ? good() : bad('We could not find that design.', 404);
    }
    case 'spec': {
      const r = await changeSpec(c, id, {
        productSlug: String(b.productSlug ?? ''), sizeKey: b.sizeKey ? String(b.sizeKey) : null,
        widthFt: b.widthFt != null && b.widthFt !== '' ? Number(b.widthFt) : null, heightFt: b.heightFt != null && b.heightFt !== '' ? Number(b.heightFt) : null,
        quantity: b.quantity ? Number(b.quantity) : undefined,
      });
      return r.ok ? good() : fail(r);
    }
    case 'sketch': {
      const r = await requestSketch(c, id);
      return r.ok ? good({ versionId: r.versionId, left: r.left }) : fail(r);
    }
    case 'like':
      return (await chooseLiked(c, id, String(b.versionId ?? ''))) ? good() : bad('Choose one of your free sketches.');
    case 'unlock_pack': {
      const r = await unlockWithPack(c, id);
      return r.ok ? good() : fail(r);
    }
    case 'change': {
      const r = await requestChange(c, id, { fromVersionId: String(b.fromVersionId ?? ''), note: String(b.note ?? '') });
      return r.ok ? good({ made: r.made }) : fail(r);
    }
    case 'premium_final': {
      const r = await requestPremiumFinal(c, id, String(b.fromVersionId ?? ''));
      return r.ok ? good({ versionId: r.versionId }) : fail(r);
    }
    case 'adapt': {
      const r = await requestAdapt(c, id, {
        fromVersionId: String(b.fromVersionId ?? ''), productSlug: String(b.productSlug ?? ''), sizeKey: b.sizeKey ? String(b.sizeKey) : null,
        widthFt: b.widthFt != null && b.widthFt !== '' ? Number(b.widthFt) : null, heightFt: b.heightFt != null && b.heightFt !== '' ? Number(b.heightFt) : null,
      });
      return r.ok ? good({ versionId: r.versionId }) : fail(r);
    }
    case 'tweak': {
      const r = await tweak(c, id, { fromVersionId: String(b.fromVersionId ?? ''), brief: b.brief });
      return r.ok ? good({ versionId: r.versionId }) : fail(r);
    }
    case 'finish': {
      const r = await requestFinish(c, id, String(b.versionId ?? ''));
      return r.ok ? good() : fail(r);
    }
    case 'approve': {
      const r = await approve(c, id, String(b.versionId ?? ''), { spellingConfirmed: b.spellingConfirmed === true });
      return r.ok ? good({ review: r.review }) : fail(r);
    }
    case 'reopen': {
      const r = await reopen(c, id);
      return r.ok ? good() : fail(r);
    }
    case 'share': {
      const vid = b.versionId ? String(b.versionId) : null;
      return (await setShared(c, id, vid)) ? good() : bad('Choose a finished design to share.');
    }
    case 'vector': {
      const vid = String(b.versionId ?? '');
      const v = await getVersion(vid);
      if (!v || v.project_id !== id || v.status !== 'ready' || v.kind === 'sketch') return bad('Choose a design you have unlocked.');
      if (!p.tier) return bad('Unlock this design first.');
      if (v.svg_key) return good();
      if (p.tier === 'standard') {
        const paid = await one<{ raw: any }>("select raw from studio_purchases where project_id = $1 and sku = 'vector' and status = 'paid' order by created_at desc limit 1", [id]);
        if (!p.vector_paid || paid?.raw?.versionId !== vid) return bad('The vector file is a small extra for Standard designs.', 402, { code: 'buy_vector' });
      } else {
        const n = await one<{ n: string }>("select count(*) as n from studio_versions where project_id = $1 and (svg_key is not null or payload->>'vector' in ('queued','running'))", [id]);
        if (Number(n?.n ?? 0) >= 4) return bad('You have made four vector files for this design. Please contact us on the Help page if you need more.');
      }
      return (await requestVector(id, vid)) ? good() : bad('That vector file is already being made.');
    }
    case 'order': {
      const r = await startOrder(c, id, { quantity: b.quantity ? Number(b.quantity) : undefined });
      return r.ok ? good({ orderId: r.orderId, next: r.next, credit: r.creditCode, couponMessage: r.couponMessage ?? null }) : fail(r);
    }
    case 'delete': {
      const r = await deleteProject(c, id);
      return r.ok ? good({ next: '/studio/projects' }) : fail(r);
    }
    default:
      return bad('That is not something Studio can do.');
  }
}

void getProject;
