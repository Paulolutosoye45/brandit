import { query, one } from './db';
import { describeArrival, describeWhen } from './time';
import { STAGES, STAGE_LABEL, type Stage } from './types';
import { statusOf, type JobStatus } from './jobs';
import { getSettings } from './settings';
import { effectiveWindow, windowText } from './windows';
import { liveFor } from './rider';

export type TrackerStep = { stage: Stage; label: string; at: string | null; state: 'done' | 'current' | 'todo'; note: string | null };
export type Tracker = {
  code: string;
  token: string;
  orderId: string;
  paid: boolean;
  status: string;
  productName: string;
  summary: string;
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
  const o = await one<any>(
    `select o.*, coalesce(i.label, p.name) as product_name, i.quantity, i.id as item_id, i.artwork_path, i.size_key, i.width_ft, i.height_ft, i.config
     from orders o join order_items i on i.order_id = o.id join products p on p.id = i.product_id where o.public_token = $1`,
    [publicToken],
  );
  if (!o) return null;
  const job = await one<any>('select * from jobs where order_id = $1', [o.id]);
  const events = job ? await query<any>('select to_stage, created_at, note from job_events where job_id = $1 order by id', [job.id]) : [];
  const settings = await getSettings();
  const stage: Stage | null = job ? job.stage : null;
  const idx = stage ? STAGES.indexOf(stage) : -1;
  const designPath = o.artwork_path === 'design';

  const steps: TrackerStep[] = STAGES.filter((s) => designPath || s !== 'proof').map((s) => {
    const at = s === 'paid' ? o.paid_at : (events.find((e: any) => e.to_stage === s)?.created_at ?? null);
    const i = STAGES.indexOf(s);
    const state: TrackerStep['state'] = !job ? 'todo' : i < idx || stage === 'delivered' ? 'done' : i === idx ? 'current' : 'todo';
    return { stage: s, label: STAGE_LABEL[s], at: at ? new Date(at).toISOString() : null, state, note: stepNote[s] ?? null };
  });

  const jobStatus = job ? statusOf({ stage: job.stage, clock_paused: job.clock_paused, promised_at: o.promised_at, at_risk: job.at_risk }, now) : null;
  const paid = !!o.paid_at;
  const promisedAt = o.promised_at ? new Date(o.promised_at) : null;
  let headline: string;
  let subline: string | null = null;
  if (!paid) headline = 'Waiting for payment';
  else if (stage === 'delivered') headline = o.pickup ? 'Picked up' : 'Delivered';
  else if (job?.clock_paused) {
    headline = stage === 'proof' ? 'Waiting for you to approve the proof' : 'Waiting on you';
    subline = job.paused_reason;
  } else if (!promisedAt) headline = 'We set your arrival time when you approve your proof';
  else headline = `${o.pickup ? 'Ready for pickup' : 'Arrives'} ${describeArrival(promisedAt, now)}`;
  if (jobStatus === 'late') subline = 'We are running late, and that is on us.';
  else if (jobStatus === 'at_risk' && !subline) subline = 'We are watching this one closely.';

  const proof = job && stage === 'proof' ? await one<{ token: string }>("select token from proofs where order_item_id = $1 and status = 'sent' order by version desc limit 1", [o.item_id]) : null;
  const qc = await one<{ id: string }>("select id from files where order_item_id = $1 and kind = 'qc_photo' order by created_at desc limit 1", [o.item_id]);
  const del = await one<any>('select * from deliveries where order_id = $1', [o.id]);
  const review = await one('select 1 as x from reviews where order_id = $1', [o.id]);
  const sizeLabel = o.width_ft ? ` · ${o.width_ft} × ${o.height_ft} ft` : '';
  const delivered = stage === 'delivered';
  const win = paid && !delivered ? effectiveWindow(o.delivery_window, { speed: o.speed, pickup: !!o.pickup, enabled: settings.windows_enabled }) : null;

  return {
    code: o.code,
    token: o.public_token,
    orderId: o.id,
    paid,
    status: o.status,
    productName: o.product_name,
    summary: `${o.quantity.toLocaleString('en-US')} × ${o.product_name}${sizeLabel}`,
    speed: o.speed,
    promisedAt: promisedAt ? promisedAt.toISOString() : null,
    headline,
    subline,
    jobStatus,
    pickup: o.pickup,
    stage,
    steps,
    pausedReason: job?.clock_paused ? job.paused_reason : null,
    qcPhotoFileId: qc?.id ?? null,
    deliveryCode: stage === 'out_for_delivery' ? o.delivery_code : null,
    rider: del?.rider_name ? { name: del.rider_name, phone: del.rider_phone, trackingUrl: del.tracking_url } : null,
    deliveryWindow: win ? windowText(win) : null,
    riderLive: stage === 'out_for_delivery' && !o.pickup ? await liveFor(o.id, now) : null,
    riderNearby: stage === 'out_for_delivery' && !o.pickup && !!del?.nearby_at,
    proofToken: proof?.token ?? null,
    needsFileFix: !!(job?.clock_paused && stage === 'file_check'),
    delivered,
    canReport: delivered && o.delivered_at && now.getTime() < new Date(o.delivered_at).getTime() + settings.claim_window_hours * 3_600_000,
    hasReview: !!review,
    totalKobo: o.total_kobo,
    businessInvoice: !!o.business_id,
  };
}

export const whenText = (iso: string | null) => (iso ? describeWhen(new Date(iso)) : null);
