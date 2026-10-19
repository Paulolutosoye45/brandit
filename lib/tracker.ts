import { query, one } from './db';
import { describeArrival, describeWhen } from './time';
import { STAGES, STAGE_LABEL, type Stage } from './types';
import { statusOf, type JobStatus } from './jobs';
import { getSettings } from './settings';
import { effectiveWindow, windowText } from './windows';
import { liveFor } from './rider';
import { proofLabel, proofStateOf, type ProofState } from './lines';

export type TrackerStep = { stage: Stage; label: string; at: string | null; state: 'done' | 'current' | 'todo'; note: string | null };
export type TrackerLine = {
  itemId: string;
  name: string;
  quantity: number;
  summary: string;
  stage: Stage | null;
  stageLabel: string;
  proof: ProofState;
  proofText: string;
  needsFileFix: boolean;
  pausedReason: string | null;
  proofToken: string | null;
  qcPhotoFileId: string | null;
  /** For a line made by Studio that is still waiting for the customer: the design to open. */
  studioProjectId: string | null;
};

export type Tracker = {
  code: string;
  token: string;
  orderId: string;
  paid: boolean;
  status: string;
  productName: string;
  summary: string;
  /** Every product in the order, with where it has got to. One entry for an ordinary order. */
  lines: TrackerLine[];
  speed: '24h' | 'standard' | null;
  promisedAt: string | null;
  headline: string;
  subline: string | null;
  jobStatus: JobStatus | null;
  pickup: boolean;
  stage: Stage | null;
  steps: TrackerStep[];
  pausedReason: string | null;
  qcPhotoFileId: string | null;
  deliveryCode: string | null;
  rider: { name: string; phone: string | null; trackingUrl: string | null } | null;
  deliveryWindow: string | null;
  riderLive: { updatedAt: string; mapUrl: string } | null;
  riderNearby: boolean;
  proofToken: string | null;
  needsFileFix: boolean;
  delivered: boolean;
  canReport: boolean;
  hasReview: boolean;
  totalKobo: number;
  businessInvoice: boolean;
};

const stepNote: Partial<Record<Stage, string>> = {
  file_check: 'A person checks your file.',
  proof: 'You approve the proof before anything prints.',
  quality_check: 'We check the finished job and take a photo.',
};

export async function getTracker(publicToken: string, now = new Date()): Promise<Tracker | null> {
  const o = await one<any>('select * from orders where public_token = $1', [publicToken]);
  if (!o) return null;
  const items = await query<any>(
    `select i.*, coalesce(i.label, p.name) as product_name from order_items i join products p on p.id = i.product_id where i.order_id = $1 order by i.position, i.id`, [o.id]);
  if (items.length === 0) return null;
  const jobs = await query<any>('select * from jobs where order_id = $1', [o.id]);
  const jobOf = (itemId: string) => jobs.find((j) => j.order_item_id === itemId) ?? null;
  const events: Record<string, any[]> = {};
  for (const j of jobs) events[j.id] = await query<any>('select to_stage, created_at, note from job_events where job_id = $1 order by id', [j.id]);
  const settings = await getSettings();
  const idxOf = (st: Stage) => STAGES.indexOf(st);

  // The order as a whole is as far along as its slowest line that is not delivered yet.
  const open = jobs.filter((j) => j.stage !== 'delivered');
  const slowestJob = open.length ? open.reduce((a, b) => (idxOf(b.stage) < idxOf(a.stage) ? b : a)) : (jobs[0] ?? null);
  const stage: Stage | null = jobs.length ? (open.length ? slowestJob.stage : 'delivered') : null;
  const idx = stage ? idxOf(stage) : -1;
  const anyDesign = items.some((i) => i.artwork_path === 'design' || i.artwork_path === 'studio');
  const multi = items.length > 1;
  const paused = jobs.filter((j) => j.clock_paused);
  const firstPaused = paused[0] ?? null;

  // The order's own timeline shows each step when the slowest line reached it.
  const allEvents = jobs.flatMap((j) => events[j.id] ?? []);
  const lastReach = (x: Stage) => {
    const times = jobs.map((j) => (events[j.id] ?? []).find((e: any) => e.to_stage === x)?.created_at ?? null);
    return times.some((t) => !t) ? null : times.map((t) => new Date(t).getTime()).reduce((a, b) => Math.max(a, b));
  };
  const steps: TrackerStep[] = STAGES.filter((x) => anyDesign || x !== 'proof').map((x) => {
    const when = x === 'paid' ? o.paid_at : (jobs.length === 1 ? (allEvents.find((e: any) => e.to_stage === x)?.created_at ?? null) : (lastReach(x) ? new Date(lastReach(x)!) : null));
    const i = idxOf(x);
    const state: TrackerStep['state'] = !jobs.length ? 'todo' : i < idx || stage === 'delivered' ? 'done' : i === idx ? 'current' : 'todo';
    return { stage: x, label: STAGE_LABEL[x], at: when ? new Date(when).toISOString() : null, state, note: stepNote[x] ?? null };
  });

  const lines: TrackerLine[] = [];
  for (const it of items) {
    const j = jobOf(it.id);
    const proof = j && j.stage === 'proof' ? await one<{ token: string }>("select token from proofs where order_item_id = $1 and status = 'sent' order by version desc limit 1", [it.id]) : null;
    const qc = await one<{ id: string }>("select id from files where order_item_id = $1 and kind = 'qc_photo' order by created_at desc limit 1", [it.id]);
    const ps = proofStateOf(it, j);
    lines.push({
      itemId: it.id,
      name: it.product_name,
      quantity: it.quantity,
      summary: `${it.quantity.toLocaleString('en-US')} × ${it.product_name}${it.width_ft ? ` · ${it.width_ft} × ${it.height_ft} ft` : ''}`,
      stage: j ? j.stage : null,
      stageLabel: j ? STAGE_LABEL[j.stage as Stage] : 'Waiting for payment',
      proof: ps,
      proofText: proofLabel(ps),
      needsFileFix: !!(j?.clock_paused && j.stage === 'file_check' && it.artwork_path !== 'studio'),
      studioProjectId: it.artwork_path === 'studio' && it.studio_project_id ? it.studio_project_id : null,
      pausedReason: j?.clock_paused ? j.paused_reason : null,
      proofToken: proof?.token ?? null,
      qcPhotoFileId: qc?.id ?? null,
    });
  }

  const jobStatus = jobs.length ? statusOf({ stage: stage!, clock_paused: paused.length > 0, promised_at: o.promised_at, at_risk: jobs.some((j) => j.at_risk) }, now) : null;
  const paid = !!o.paid_at;
  const promisedAt = o.promised_at ? new Date(o.promised_at) : null;
  const named = (l: TrackerLine, text: string | null) => (multi && text ? `${l.name}: ${text}` : text);
  let headline: string;
  let subline: string | null = null;
  if (!paid) headline = 'Waiting for payment';
  else if (stage === 'delivered') headline = o.pickup ? 'Picked up' : 'Delivered';
  else if (firstPaused) {
    const pl = lines.find((l) => l.itemId === firstPaused.order_item_id)!;
    headline = firstPaused.stage === 'proof' ? 'Waiting for you to approve the proof' : pl.studioProjectId ? 'Waiting for you to approve your design' : 'Waiting on you';
    subline = named(pl, firstPaused.paused_reason);
  } else if (!promisedAt) headline = 'We set your arrival time when you approve your proof';
  else headline = `${o.pickup ? 'Ready for pickup' : 'Arrives'} ${describeArrival(promisedAt, now)}`;
  if (jobStatus === 'late') subline = 'We are running late, and that is on us.';
  else if (jobStatus === 'at_risk' && !subline) subline = 'We are watching this one closely.';

  const del = await one<any>('select * from deliveries where order_id = $1', [o.id]);
  const review = await one('select 1 as x from reviews where order_id = $1', [o.id]);
  const delivered = stage === 'delivered';
  const win = paid && !delivered ? effectiveWindow(o.delivery_window, { speed: o.speed, pickup: !!o.pickup, enabled: settings.windows_enabled }) : null;
  const fix = lines.find((l) => l.needsFileFix);
  const proofLine = lines.find((l) => l.proofToken);
  const first = items[0];
  const sizeLabel = first.width_ft ? ` · ${first.width_ft} × ${first.height_ft} ft` : '';

  return {
    code: o.code,
    token: o.public_token,
    orderId: o.id,
    paid,
    status: o.status,
    productName: multi ? `${first.product_name} + ${items.length - 1} more` : first.product_name,
    summary: multi ? lines.map((l) => `${l.quantity.toLocaleString('en-US')} × ${l.name}`).join(', ') : `${first.quantity.toLocaleString('en-US')} × ${first.product_name}${sizeLabel}`,
    lines,
    speed: o.speed,
    promisedAt: promisedAt ? promisedAt.toISOString() : null,
    headline,
    subline,
    jobStatus,
    pickup: o.pickup,
    stage,
    steps,
    pausedReason: firstPaused ? named(lines.find((l) => l.itemId === firstPaused.order_item_id)!, firstPaused.paused_reason) : null,
    qcPhotoFileId: lines.find((l) => l.qcPhotoFileId)?.qcPhotoFileId ?? null,
    deliveryCode: stage === 'out_for_delivery' ? o.delivery_code : null,
    rider: del?.rider_name ? { name: del.rider_name, phone: del.rider_phone, trackingUrl: del.tracking_url } : null,
    deliveryWindow: win ? windowText(win) : null,
    riderLive: stage === 'out_for_delivery' && !o.pickup ? await liveFor(o.id, now) : null,
    riderNearby: stage === 'out_for_delivery' && !o.pickup && !!del?.nearby_at,
    proofToken: proofLine?.proofToken ?? null,
    needsFileFix: !!fix,
    delivered,
    canReport: delivered && o.delivered_at && now.getTime() < new Date(o.delivered_at).getTime() + settings.claim_window_hours * 3_600_000,
    hasReview: !!review,
    totalKobo: o.total_kobo,
    businessInvoice: !!o.business_id,
  };
}

export const whenText = (iso: string | null) => (iso ? describeWhen(new Date(iso)) : null);
