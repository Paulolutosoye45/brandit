import { notFound } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import { requireStaff } from '@/lib/session';
import { query, one } from '@/lib/db';
import { can } from '@/lib/permissions';
import { statusOf } from '@/lib/jobs';
import { STAGES, STAGE_LABEL, type Stage } from '@/lib/types';
import { describeWhen, durationText } from '@/lib/time';
import { appUrl } from '@/lib/messages';
import { naira } from '@/lib/money';
import { Notice, StatusPill } from '@/components/Bits';
import { PrintButton } from '@/components/PrintButton';
import { CopyButton } from '@/components/CopyButton';
import { effectiveWindow, windowText } from '@/lib/windows';
import { riderUrl, riderWhatsAppLink } from '@/lib/rider';
import { getSettings } from '@/lib/settings';
import { studioFacts } from '@/lib/studio/attach';
import { proofLabel, proofStateOf } from '@/lib/lines';
import * as A from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job' };

const Btn = ({ children, secondary }: { children: React.ReactNode; secondary?: boolean }) => <button className={secondary ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}>{children}</button>;

export default async function JobPage(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const staff = await requireStaff();
  const j = await one<any>(
    `select j.*, o.code, o.public_token, o.speed, o.promised_at, o.pickup, o.area, o.address, o.delivery_code, o.delivery_window, o.template_id, o.plain_pack, o.total_kobo, o.status as order_status, o.paid_at, o.delivered_at,
            i.id as item_id, i.quantity, i.config, i.size_key, i.width_ft, i.height_ft, i.artwork_path, i.design_brief, i.names, i.preview_approved_at, i.artwork_file_id, coalesce(i.label, p.name) as product_name, p.sizes,
            c.name as cname, coalesce(c.whatsapp_phone, c.phone) as phone, c.email, b.name as company
     from jobs j join orders o on o.id = j.order_id join order_items i on i.id = j.order_item_id join products p on p.id = i.product_id
     left join customers c on c.id = o.customer_id left join businesses b on b.id = o.business_id where j.id = $1`,
    [params.id],
  );
  if (!j) notFound();
  if (staff.role === 'partner_press' && j.press_id !== staff.press_id) notFound();

  const now = new Date();
  const stage = j.stage as Stage;
  const status = statusOf({ stage, clock_paused: j.clock_paused, promised_at: j.promised_at, at_risk: j.at_risk }, now);
  const [events, files, proofs, msgs, presses, delivery, claims, siblings] = await Promise.all([
    query<any>('select e.*, s.name as staff_name from job_events e left join staff s on s.id = e.staff_id where e.job_id = $1 order by e.id desc', [j.id]),
    query<any>("select id, kind, original_name, mime, check_result, width_px, height_px, created_at, original_file_id, fix_note from files where order_item_id = $1 order by created_at desc", [j.item_id]),
    query<any>('select * from proofs where order_item_id = $1 order by version desc', [j.item_id]),
    query<any>('select template, channel, status, error, created_at from messages where order_id = $1 order by id desc limit 12', [j.order_id]),
    query<any>('select id, name from presses order by name'),
    one<any>('select * from deliveries where order_id = $1', [j.order_id]),
    query<any>('select kind, status, resolution, description from claims where order_id = $1', [j.order_id]),
    query<any>(
      `select j2.id, j2.stage, coalesce(i.label, p.name) as name, i.quantity, i.artwork_path, i.preview_approved_at, i.artwork_file_id, (i.id = $2::uuid) as me,
         (select pf.status from proofs pf where pf.order_item_id = i.id order by pf.version desc limit 1) as proof_status
       from jobs j2 join order_items i on i.id = j2.order_item_id join products p on p.id = i.product_id where j2.order_id = $1 order by i.position, i.id`, [j.order_id, j.item_id]),
  ]);
  const art = files.find((f) => f.id === j.artwork_file_id);
  const qc = files.find((f) => f.kind === 'qc_photo');
  const qr = await QRCode.toDataURL(`${appUrl()}/console/scan/${j.id}`, { margin: 1, width: 160, color: { dark: '#0B1F33', light: '#FFFFFF' } });
  const seeContact = can(staff.role, 'see_contact');
  const addr = j.address ?? {};
  const left = j.promised_at ? new Date(j.promised_at).getTime() - now.getTime() : null;
  const size = (j.sizes as any[]).find((s) => s.key === j.size_key);
  const cfg = Object.entries(j.config ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
  const brief = j.design_brief as any;
  const win = j.pickup ? null : effectiveWindow(j.delivery_window, { speed: j.speed, pickup: j.pickup, enabled: (await getSettings()).windows_enabled });
  const riderLink = delivery?.rider_token ? riderUrl(delivery.rider_token) : null;
  const riderWa = riderLink ? riderWhatsAppLink(delivery?.rider_phone, riderLink, j.code) : null;
  const ago = (d: any) => { const m = Math.max(0, Math.round((now.getTime() - new Date(d).getTime()) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : describeWhen(new Date(d)); };
  const latestProof = proofs[0];
  const studio = await studioFacts(j.order_id).catch(() => null);

  return (
    <div className="grid gap-6 max-w-[1100px]">
      <div className="no-print"><Link href="/console/queue" className="text-[15px] font-bold text-muted hover:text-ink inline-flex min-h-[44px] items-center">Job queue</Link></div>
      {searchParams.e && <Notice tone="bad">{searchParams.e}</Notice>}
      {searchParams.ok && <Notice tone="good">{searchParams.ok}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px] items-start">
        <div className="grid gap-6 min-w-0">
          <section className="card p-5 grid gap-3" aria-label="Job ticket">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-[32px]">{j.code}</h1>
              <div className="flex gap-2 items-center">{j.speed === '24h' && <span className="pill bg-ink text-white">24-hour</span>}<StatusPill status={status} />{j.reprint_count > 0 && <span className="pill bg-warn-tint text-warn">Reprint {j.reprint_count}</span>}</div>
            </div>
            <p className="font-bold text-[20px]">{brief?.custom ? j.product_name : `${j.quantity.toLocaleString('en-US')} × ${j.product_name}`}{j.width_ft ? ` · ${j.width_ft} × ${j.height_ft} ft` : size && j.sizes.length > 1 ? ` · ${size.label}` : ''}</p>
            {cfg && <p className="text-muted">{cfg}</p>}
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[15px]">
              <div className="flex justify-between gap-3"><dt className="text-muted">Promised</dt><dd className="font-bold text-right">{j.promised_at ? describeWhen(new Date(j.promised_at)) : 'Set when the proof is approved'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Time left</dt><dd className={`font-bold tabular ${status === 'late' ? 'text-bad' : ''}`}>{left == null || j.clock_paused ? '—' : left < 0 ? `${durationText(-left)} late` : durationText(left)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Stage</dt><dd className="font-bold">{STAGE_LABEL[stage]}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Delivery</dt><dd className="font-bold">{j.pickup ? 'Customer pickup' : (addr.area ?? j.area ?? '—')}</dd></div>
              {win && <div className="flex justify-between gap-3"><dt className="text-muted">Window</dt><dd className="font-bold text-right">{windowText(win)}</dd></div>}
              {j.plain_pack && <div className="flex justify-between gap-3 sm:col-span-2"><dt className="text-muted">Packing</dt><dd className="font-bold text-bad">Plain pack: no Brandit name on the slip</dd></div>}
            </dl>
            {j.clock_paused && <Notice tone="warn"><span className="font-bold">Clock paused.</span> {j.paused_reason}</Notice>}
            <ol className="flex flex-wrap gap-1.5 pt-1" aria-label="Stages">
              {STAGES.filter((s) => s !== 'proof' || j.artwork_path === 'design').map((s) => <li key={s} className={`pill ${s === stage ? 'bg-accent text-ink ring-2 ring-ink' : STAGES.indexOf(s) < STAGES.indexOf(stage) ? 'bg-good-tint text-good' : 'bg-placeholder text-muted'}`}>{STAGE_LABEL[s]}</li>)}
            </ol>
          </section>

          {Array.isArray(j.names) && j.names.length > 0 && (
            <section className="card p-5 grid gap-3" aria-label="Names to print">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><h2 className="text-[22px]">Names to print</h2><p className="text-[14px] text-muted">{j.names.length} {j.names.length === 1 ? 'name' : 'names'}, {(j.names as any[]).reduce((a, r) => a + (Number(r.qty) || 0), 0)} pieces. Each one is printed with its own name.</p></div>
                <a className="btn-secondary btn-sm" href={`/api/console/jobs/${j.id}/names`} download>Download as spreadsheet</a>
              </div>
              <div className="overflow-x-auto rounded-md2 border border-line">
                <table className="w-full min-w-[420px] text-left text-[15px]">
                  <thead><tr className="border-b border-line text-[13px] text-muted"><th className="px-3 py-2 font-bold">No.</th><th className="px-3 py-2 font-bold">Name</th><th className="px-3 py-2 font-bold">Note</th><th className="px-3 py-2 font-bold">Copies</th></tr></thead>
                  <tbody>
                    {(j.names as any[]).slice(0, 25).map((r, i) => <tr key={i} className="border-b border-line last:border-0"><td className="px-3 py-1.5 tabular text-muted">{i + 1}</td><td className="px-3 py-1.5 font-bold">{r.name}</td><td className="px-3 py-1.5">{r.note}</td><td className="px-3 py-1.5 tabular">{r.qty}</td></tr>)}
                  </tbody>
                </table>
              </div>
              {j.names.length > 25 && <p className="text-[14px] text-muted">The first 25 are shown. Download the spreadsheet for all {j.names.length}.</p>}
            </section>
          )}

          {siblings.length > 1 && (
            <section className="card p-5 grid gap-3" aria-label="Everything in this order">
              <div><h2 className="text-[22px]">All {siblings.length} products in {j.code}</h2><p className="text-[14px] text-muted">One payment and one delivery. Each product is checked, proofed and printed on its own. The rider leaves when the last one is ready.</p></div>
              <ul className="grid divide-y divide-line">
                {siblings.map((l: any) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-[15px]">
                    {l.me ? <span className="font-bold">{l.quantity.toLocaleString('en-US')} × {l.name} (this job)</span> : <Link className="font-bold underline" href={`/console/jobs/${l.id}`}>{l.quantity.toLocaleString('en-US')} × {l.name}</Link>}
                    <span className="text-muted">{STAGE_LABEL[l.stage as Stage]} · {proofLabel(proofStateOf(l, { stage: l.stage }))}{l.proof_status === 'changes_requested' ? ' · changes asked for' : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-5 grid gap-3" aria-label="Artwork">
            <h2 className="text-[22px]">Artwork</h2>
            {j.artwork_path === 'studio' ? (
              <Notice tone="neutral"><span className="font-bold">Made by Brandit Studio.</span> The customer has paid for the design with this order. Studio is making the concepts. When they approve one (and a Brandit designer has checked it, on Premium) the print file lands here and this job goes to the file desk. Nothing to do yet.</Notice>
            ) : j.artwork_path === 'design' ? (
              <div className="grid gap-2 text-[15px]">
                <p className="font-bold">{brief?.custom ? `Custom job (request ${brief.request})` : `Design job${brief?.fix ? ' (fix my file)' : ''}`}</p>
                <dl className="grid gap-1.5">{(brief?.custom
                  ? [['What they asked for', brief.details], ['How many', brief.quantity_text], ['Size', brief.size_text], ['What we agreed in the quote', brief.quote_note]]
                  : [['For', brief?.purpose], ['Exact words', brief?.wording], ['Colours', brief?.colours], ['Look at', brief?.examples]]).filter(([, v]) => v).map(([k, v]) => <div key={k as string}><dt className="text-muted text-[13px]">{k}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>)}</dl>
                {files.filter((f) => f.kind === 'artwork').map((f) => <a key={f.id} className="underline font-bold" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">Reference: {f.original_name}</a>)}
                {brief?.template && <p className="rounded-md2 bg-accent/30 px-3 py-2"><span className="font-bold">From the template:</span> {brief.template.title}</p>}
                {brief?.event_plan && (
                  <div className="grid gap-1 rounded-md2 bg-paper2 p-3">
                    <p className="font-bold">Event plan: {brief.event_plan.typeLabel} on {brief.event_plan.date} · about {brief.event_plan.guests} guests</p>
                    <ul className="list-disc pl-5">{(brief.event_plan.items ?? []).map((it: any) => <li key={it.key}>{it.label}: <span className="font-bold">{it.qty}</span> {it.unit}</li>)}</ul>
                    {brief.event_plan.extra && <p>Also: {brief.event_plan.extra}</p>}
                    {brief.event_plan.notes && <p>Notes: {brief.event_plan.notes}</p>}
                  </div>
                )}
                {brief?.brand_kit && (
                  <div className="grid gap-1 rounded-md2 bg-paper2 p-3">
                    <p className="font-bold">Customer&apos;s brand kit{brief.brand_kit.name ? `: ${brief.brand_kit.name}` : ''}</p>
                    {brief.brand_kit.tagline && <p>Tagline: {brief.brand_kit.tagline}</p>}
                    {brief.brand_kit.colours && <p>Colours: {brief.brand_kit.colours}</p>}
                    {brief.brand_kit.fonts && <p>Fonts: {brief.brand_kit.fonts}</p>}
                    {brief.brand_kit.tone && <p>Tone: {brief.brand_kit.tone}</p>}
                    {brief.brand_kit.contact && <p>Contact line: {brief.brand_kit.contact}</p>}
                    {brief.brand_kit.website && <p>Website: {brief.brand_kit.website}</p>}
                    {brief.brand_kit.notes && <p>Notes: {brief.brand_kit.notes}</p>}
                    {(brief.brand_kit.assets ?? []).length > 0 && <ul className="flex flex-wrap gap-x-4 gap-y-1">{brief.brand_kit.assets.map((a: any) => <li key={a.id}><a className="underline font-bold" href={`/api/brand-assets/${a.id}`} target="_blank" rel="noreferrer">{a.kind === 'logo' ? 'Logo' : 'Past design'}: {a.title}</a></li>)}</ul>}
                  </div>
                )}
                <p className="text-muted">Proof rounds so far: {proofs.filter((p) => p.status === 'changes_requested').length} of 2 included.</p>
              </div>
            ) : art ? (
              <div className="grid gap-3">
                <div className="grid sm:grid-cols-[180px_1fr] gap-4 items-start">
                  {art.mime.startsWith('image') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${art.id}`} alt="Customer artwork" className="w-full max-h-[200px] object-contain bg-placeholder rounded-sm2" />
                  ) : <a className="btn-secondary btn-sm" href={`/api/files/${art.id}`} target="_blank" rel="noreferrer">Open PDF</a>}
                  <div className="grid gap-1.5 text-[15px]">
                    <p className="font-bold break-all">{art.original_name}</p>
                    {art.width_px && <p className="text-muted">{art.width_px} × {art.height_px} px{art.check_result?.dpi ? ` · ${art.check_result.dpi} dots per inch at print size` : ''}</p>}
                    {art.fix_note?.startsWith('bleed') && <p className="font-bold">The customer asked us to add a 3 mm extra edge (mirrored). This file is that copy; their own file is the one before it in the list.</p>}
                    <p>Automatic check: <StatusPill status={art.check_result?.status === 'pass' ? 'good' : art.check_result?.status === 'warn' ? 'warn' : 'bad'} label={art.check_result?.status ?? 'unchecked'} /></p>
                    <p>Customer approved the preview: <span className="font-bold">{j.preview_approved_at ? describeWhen(new Date(j.preview_approved_at)) : 'not yet'}</span></p>
                    <a className="underline font-bold" href={`/api/files/${art.id}`} target="_blank" rel="noreferrer">Open the file at full size</a>
                  </div>
                </div>
                <ul className="grid gap-1 text-[14px]">{(art.check_result?.lines ?? []).filter((l: any) => l.status !== 'pass').map((l: any) => <li key={l.id}><span className="font-bold">{l.label}:</span> {l.message}</li>)}</ul>
              </div>
            ) : brief?.kind === 'sample' ? (
              <Notice tone="neutral"><span className="font-bold">Sample pack.</span> There is no artwork to print. Pack the paper and finish samples, take a photo of the pack for the quality check, and send it out like any other order. Its price comes back to the customer as credit on their first order.</Notice>
            ) : brief?.kind === 'file_later' ? (
              <Notice tone="warn"><span className="font-bold">Built from a WhatsApp chat.</span> The customer paid before sending the file. They have a message with a link to upload it. When it arrives, check it and send it to print.</Notice>
            ) : <p className="text-muted">No file yet.</p>}
            {studio && (
              <div className="grid gap-1 rounded-md2 bg-accent/30 p-3 text-[14px]">
                <p className="font-bold">Made with Brandit Studio ({studio.tier ?? 'design'})</p>
                <p>The customer approved this exact file{studio.approvedAt ? ` on ${describeWhen(new Date(studio.approvedAt))}` : ''} and ticked that every name, date and number is spelled right{studio.spellingConfirmedAt ? '' : ' (not recorded)'}.</p>
                <p>File fingerprint (SHA-256): <span className="break-all font-mono text-[12px]">{studio.sha256}</span></p>
                <p>Designer check: <span className="font-bold">{studio.review ? (studio.review.status === 'passed' ? 'passed' : studio.review.status === 'changes' ? 'sent back' : 'waiting') : 'not part of this design'}</span>{studio.review?.note ? ` — ${studio.review.note}` : ''}</p>
                {studio.creditKobo > 0 && <p>A design credit of {naira(studio.creditKobo)} is on this order.</p>}
                <p className="text-muted">Print the file as it is. If something looks wrong, send a proof instead of editing the file.</p>
              </div>
            )}
          </section>

          <section className="card p-5 grid gap-5 no-print" aria-label="Actions">
            <h2 className="text-[22px]">What happens next</h2>

            {stage === 'file_check' && can(staff.role, 'file_review') && j.artwork_path !== 'studio' && (
              <div className="grid gap-5">
                {j.artwork_path === 'upload' && (
                  <form action={A.passFile} className="grid gap-2"><input type="hidden" name="jobId" value={j.id} />
                    <Btn>File is good: send to print</Btn>
                    {!j.preview_approved_at && <p className="text-[14px] text-bad font-bold">The customer has not approved the preview yet, so this will be refused.</p>}
                  </form>
                )}
                <form action={A.uploadProof} className="grid gap-2 border-t border-line pt-4"><input type="hidden" name="jobId" value={j.id} />
                  <label className="label !mb-0" htmlFor="pf">{j.artwork_path === 'design' ? 'Upload the proof' : 'Fixed the file yourself? Send a proof instead'}</label>
                  <input id="pf" name="file" type="file" accept="image/jpeg,image/png,application/pdf" className="field !py-2.5" />
                  {j.artwork_path !== 'design' && <input name="note" className="field" placeholder="Why a proof is needed (required)" />}
                  <Btn secondary>Send proof to customer</Btn>
                </form>
                <form action={A.flag} className="grid gap-2 border-t border-line pt-4"><input type="hidden" name="jobId" value={j.id} />
                  <label className="label !mb-0" htmlFor="fl">Something wrong with the file? Tell the customer in plain words</label>
                  <textarea id="fl" name="note" className="field !py-3 min-h-[80px]" placeholder="The logo is cut off on the right edge. Please upload it with some space around it." />
                  <Btn secondary>Flag the problem and pause the clock</Btn>
                </form>
              </div>
            )}

            {stage === 'proof' && (
              <div className="grid gap-4">
                <p>{latestProof ? `Proof version ${latestProof.version} is ${latestProof.status === 'sent' ? 'waiting for the customer' : latestProof.status === 'approved' ? 'approved' : 'being changed'}.` : 'No proof sent yet.'}{latestProof?.customer_note && <> The customer said: <span className="font-bold">&ldquo;{latestProof.customer_note}&rdquo;</span></>}</p>
                {can(staff.role, 'send_proof') && (
                  <form action={A.uploadProof} className="grid gap-2"><input type="hidden" name="jobId" value={j.id} /><label className="label !mb-0" htmlFor="pf2">Send a new version</label><input id="pf2" name="file" type="file" accept="image/jpeg,image/png,application/pdf" className="field !py-2.5" /><Btn>Send proof</Btn></form>
                )}
                {(staff.role === 'admin' || staff.role === 'production_lead') && (
                  <form action={A.approveByNote} className="grid gap-2 border-t border-line pt-4"><input type="hidden" name="jobId" value={j.id} /><label className="label !mb-0" htmlFor="ap">Customer approved by phone? Record how</label><input id="ap" name="note" className="field" placeholder="Approved on a call with the customer at 2:10pm" /><Btn secondary>Approve for the customer</Btn></form>
                )}
              </div>
            )}

            {stage === 'printing' && (
              <div className="grid gap-4">
                {can(staff.role, 'assign_press') && (
                  <form action={A.setPress} className="flex flex-wrap items-end gap-3"><input type="hidden" name="jobId" value={j.id} />
                    <div><label className="label" htmlFor="pr">Printing at</label><select id="pr" name="press_id" defaultValue={j.press_id ?? ''} className="field !w-auto min-w-[220px]">{presses.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div><Btn secondary>Assign</Btn></form>
                )}
                {can(staff.role, 'scan_print') && <form action={A.toQuality}><input type="hidden" name="jobId" value={j.id} /><Btn>Done printing: move to the quality check</Btn></form>}
              </div>
            )}

            {stage === 'quality_check' && can(staff.role, 'pass_qc') && (
              <div className="grid gap-5">
                <form action={A.uploadQcPhoto} className="grid gap-2"><input type="hidden" name="jobId" value={j.id} />
                  <label className="label !mb-0" htmlFor="qc">1. Photo of the finished job {qc && <span className="text-good">(added)</span>}</label>
                  <input id="qc" name="file" type="file" accept="image/jpeg,image/png" capture="environment" className="field !py-2.5" /><Btn secondary>{qc ? 'Replace the photo' : 'Add the photo'}</Btn></form>
                {!j.pickup && (
                  <form action={A.saveRider} className="grid gap-2 border-t border-line pt-4"><input type="hidden" name="jobId" value={j.id} />
                    <p className="label !mb-0">2. Rider {delivery?.rider_name && <span className="text-good">(saved: {delivery.rider_name})</span>}</p>
                    <div className="grid sm:grid-cols-2 gap-3"><input name="rider_name" className="field" placeholder="Rider name" defaultValue={delivery?.rider_name ?? ''} /><input name="rider_phone" className="field" placeholder="Rider phone" inputMode="tel" defaultValue={delivery?.rider_phone ?? ''} /></div>
                    <input name="tracking_url" className="field" placeholder="Tracking link (optional)" defaultValue={delivery?.tracking_url ?? ''} /><input name="provider" className="field" placeholder="Delivery partner (optional)" defaultValue={delivery?.provider ?? ''} /><Btn secondary>Save rider</Btn></form>
                )}
                {riderLink && (
  <div className="grid gap-2 rounded-md2 bg-paper2 p-4" aria-label="Rider link">
    <p className="font-bold">Rider link</p>
    <p className="break-all text-[14px] text-muted">{riderLink}</p>
    <div className="flex flex-wrap gap-2"><CopyButton text={riderLink} label="Copy link" />{riderWa && <a className="btn-secondary btn-sm" href={riderWa} target="_blank" rel="noreferrer">Send on WhatsApp</a>}</div>
    <p className="text-[13px] text-muted">{delivery?.started_at ? `Trip started ${ago(delivery.started_at)}. ` : 'The rider has not opened it yet. '}{delivery?.last_ping_at ? `Last location ${ago(delivery.last_ping_at)}. ` : ''}{delivery?.nearby_at ? 'The rider said they are close and the customer was told.' : ''}</p>
  </div>
)}

                <form action={A.toDelivery} className="border-t border-line pt-4"><input type="hidden" name="jobId" value={j.id} /><Btn>{j.pickup ? 'Passed: ready for pickup' : 'Passed: out for delivery'}</Btn></form>
                <form action={A.failQuality} className="grid gap-2 border-t border-line pt-4"><input type="hidden" name="jobId" value={j.id} /><label className="label !mb-0" htmlFor="fq">Did not pass? Say what is wrong</label><input id="fq" name="note" className="field" placeholder="Colours too dark on the left edge" /><Btn secondary>Send back for a reprint</Btn></form>
              </div>
            )}

            {stage === 'out_for_delivery' && can(staff.role, 'dispatch') && (
              <div className="grid gap-4">
                {riderLink && (
  <div className="grid gap-2 rounded-md2 bg-paper2 p-4" aria-label="Rider link">
    <p className="font-bold">Rider link</p>
    <p className="break-all text-[14px] text-muted">{riderLink}</p>
    <div className="flex flex-wrap gap-2"><CopyButton text={riderLink} label="Copy link" />{riderWa && <a className="btn-secondary btn-sm" href={riderWa} target="_blank" rel="noreferrer">Send on WhatsApp</a>}</div>
    <p className="text-[13px] text-muted">{delivery?.started_at ? `Trip started ${ago(delivery.started_at)}. ` : 'The rider has not opened it yet. '}{delivery?.last_ping_at ? `Last location ${ago(delivery.last_ping_at)}. ` : ''}{delivery?.nearby_at ? 'The rider said they are close and the customer was told.' : ''}</p>
  </div>
)}
                <form action={A.deliverWithCode} className="grid gap-2"><input type="hidden" name="jobId" value={j.id} />
                  <label className="label !mb-0" htmlFor="dc">The customer reads you a four-digit code. Enter it to complete the delivery</label>
                  <div className="flex gap-3"><input id="dc" name="code" inputMode="numeric" maxLength={4} className="field !w-32 text-center text-[22px] tracking-widest font-bold" /><Btn>Complete delivery</Btn></div></form>
                <form action={A.markDelivered} className="border-t border-line pt-4 grid gap-2"><input type="hidden" name="jobId" value={j.id} /><input name="note" className="field" placeholder="No code? Say why (for example, left with the security desk)" /><Btn secondary>Mark delivered without a code</Btn></form>
              </div>
            )}

            {stage === 'delivered' && <p className="text-muted">Delivered{j.delivered_at ? ` on ${describeWhen(new Date(j.delivered_at))}` : ''}. {claims.length > 0 ? 'See the Promise desk for claims on this order.' : ''}</p>}
            {stage !== 'delivered' && !(
              (stage === 'file_check' && can(staff.role, 'file_review')) || stage === 'proof' || (stage === 'printing' && (can(staff.role, 'scan_print') || can(staff.role, 'assign_press'))) ||
              (stage === 'quality_check' && can(staff.role, 'pass_qc')) || (stage === 'out_for_delivery' && can(staff.role, 'dispatch'))
            ) && <p className="text-muted">Nothing for your role to do at this stage.</p>}
          </section>

          <section className="card p-5 grid gap-3" aria-label="History">
            <h2 className="text-[22px]">History</h2>
            <ol className="grid gap-2.5">{events.map((e) => (
              <li key={e.id} className="grid sm:grid-cols-[150px_1fr] gap-x-4 text-[15px]"><span className="text-muted">{describeWhen(new Date(e.created_at))}</span><span><span className="font-bold">{STAGE_LABEL[e.to_stage as Stage]}</span>{e.staff_name ? ` · ${String(e.staff_name).split(' (')[0]}` : ''}{e.note ? `: ${e.note}` : ''}</span></li>
            ))}</ol>
          </section>
        </div>

        <aside className="grid gap-6 min-w-0">
          <section className="card p-5 grid gap-3 justify-items-center text-center" aria-label="Scan code">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={`QR code for ${j.code}`} width={160} height={160} />
            <p className="text-[14px] text-muted">Print this ticket and stick it on the job. Staff scan the code at each station.</p>
            <PrintButton label="Print the ticket" />
            <Link className="underline font-bold text-[14px] no-print" href={`/console/scan/${j.id}`}>Open the scan page</Link>
          </section>

          {staff.role !== 'partner_press' && (
            <section className="card p-5 grid gap-1.5 text-[15px] print:hidden" aria-label="Customer">
              <h2 className="text-[20px] mb-1">Customer</h2>
              {seeContact ? (<>
                <p className="font-bold">{j.company ?? j.cname ?? '—'}</p>{j.company && j.cname && <p>{j.cname}</p>}
                <p>{j.phone}</p><p className="break-all">{j.email}</p>
                {!j.pickup && addr.line1 && <p className="text-muted pt-1">{addr.line1}, {addr.area}</p>}
              </>) : (<>
                <p className="font-bold">{j.cname?.split(' ')[0] ?? '—'}</p>
                {!j.pickup && addr.line1 ? <p className="text-muted">{addr.line1}, {addr.area}</p> : <p className="text-muted">Pickup</p>}
              </>)}
              <p className="pt-2 text-muted">Order total {naira(j.total_kobo)}</p>
              {j.delivery_code && stage !== 'delivered' && <p className="text-muted">Delivery code is with the customer.</p>}
            </section>
          )}

          {staff.role !== 'partner_press' && (
            <section className="card p-5 grid gap-2 text-[14px] print:hidden" aria-label="Messages">
              <h2 className="text-[20px]">Messages sent</h2>
              {msgs.length === 0 && <p className="text-muted">None yet.</p>}
              {msgs.map((m, i) => <p key={i}><span className="font-bold">{m.template.replace(/_/g, ' ')}</span> · {m.status}{m.channel !== 'demo' ? ` by ${m.channel}` : ' (logged, no sender set up)'}{m.error && <span className="block text-bad">{m.error}</span>}</p>)}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
