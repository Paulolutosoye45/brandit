import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCustomer } from '@/lib/session';
import { brandKitFor, kitOwnerId, listAssets, savableOrders, MAX_ASSETS, MAX_ASSET_MB, KIND_LABEL } from '@/lib/brandKit';
import { businessView } from '@/lib/businessAccounts';
import { Notice } from '@/components/Bits';
import { saveKitAction, deleteAssetAction, saveDesignAction } from './actions';
import { ColourField } from './ColourField';
import { AssetUploader } from './AssetUploader';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My brand kit', robots: { index: false } };

const size = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

export default async function BrandKitPage(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  const c = await requireCustomer('/account/brand');
  const [kit, assets, savable, owner, biz] = await Promise.all([brandKitFor(c.id), listAssets(c.id), savableOrders(c.id), kitOwnerId(c.id), businessView(c.id)]);
  const shared = owner !== c.id; // a member of a company uses the company's kit and cannot change it
  return (
    <div className="mx-auto grid max-w-[860px] gap-6 px-5 py-8">
      <div>
        <Link href="/account" className="text-[14px] text-muted underline">My account</Link>
        <h1 className="mt-1 text-[34px] leading-tight sm:text-[44px]">My brand kit</h1>
        <p className="mt-1 max-w-[600px] text-[17px] text-muted">Tell us once. When you ask us to design something, your logo, colours and contact line go straight to the designer. Only you and the team working on your order can see it.</p>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      {shared && <Notice tone="neutral">This is the brand kit of <b>{biz?.name ?? 'your company'}</b>. It is used on every order you place for the company. Only {biz?.ownerName ?? 'the owner'} can change it.</Notice>}

      {shared ? (
        <section className="card grid gap-3 p-5 sm:p-6" aria-labelledby="kit-h">
          <h2 id="kit-h" className="text-[22px]">{kit?.display_name || biz?.name || 'Company brand'}</h2>
          {kit?.tagline && <p className="text-[17px]">{kit.tagline}</p>}
          <p className="flex flex-wrap items-center gap-2 text-[15px]">{[kit?.primary_hex, kit?.secondary_hex, kit?.accent_hex].filter(Boolean).map((h) => <span key={h} className="inline-flex items-center gap-2"><span aria-hidden className="inline-block h-6 w-6 rounded-sm2 border border-line" style={{ background: h! }} />{h}</span>)}</p>
          {[kit?.fonts, kit?.tone, kit?.phone_line, kit?.website, kit?.address_line].filter(Boolean).map((t) => <p key={t} className="text-[15px] text-muted">{t}</p>)}
        </section>
      ) : (
      <form action={saveKitAction} className="card grid gap-5 p-5 sm:p-6" aria-labelledby="kit-h">
        <h2 id="kit-h" className="text-[22px]">Your brand</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="display_name">Business or brand name</label><input id="display_name" name="display_name" defaultValue={kit?.display_name ?? c.name ?? ''} maxLength={80} className="field" /></div>
          <div><label className="label" htmlFor="tagline">Tagline</label><input id="tagline" name="tagline" defaultValue={kit?.tagline ?? ''} maxLength={100} className="field" placeholder="Fresh bread, every morning" /></div>
        </div>
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="label">Colours</legend>
          <ColourField id="primary_hex" name="primary_hex" label="Main" initial={kit?.primary_hex ?? null} />
          <ColourField id="secondary_hex" name="secondary_hex" label="Second" initial={kit?.secondary_hex ?? null} />
          <ColourField id="accent_hex" name="accent_hex" label="Accent" initial={kit?.accent_hex ?? null} />
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="fonts">Fonts you use</label><input id="fonts" name="fonts" defaultValue={kit?.fonts ?? ''} maxLength={120} className="field" placeholder="Montserrat for headings" /></div>
          <div><label className="label" htmlFor="tone">How should it feel?</label><input id="tone" name="tone" defaultValue={kit?.tone ?? ''} maxLength={160} className="field" placeholder="Warm, friendly, professional" /></div>
          <div><label className="label" htmlFor="phone_line">Phone line for print</label><input id="phone_line" name="phone_line" defaultValue={kit?.phone_line ?? ''} maxLength={100} className="field" placeholder="0803 123 4567 · 0902 000 0000" /></div>
          <div><label className="label" htmlFor="website">Website or Instagram</label><input id="website" name="website" defaultValue={kit?.website ?? ''} maxLength={120} className="field" placeholder="mybrand.ng" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="address_line">Address for print</label><input id="address_line" name="address_line" defaultValue={kit?.address_line ?? ''} maxLength={160} className="field" placeholder="12 Adeola Odeku Street, Victoria Island" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="notes">Anything else a designer should know?</label><textarea id="notes" name="notes" defaultValue={kit?.notes ?? ''} maxLength={600} rows={3} className="field" placeholder="Never stretch the logo. Always keep the tagline under it." /></div>
        </div>
        <button className="btn-primary self-start">Save my brand</button>
      </form>
      )}

      <section id="files" className="card grid gap-4 p-5 sm:p-6" aria-labelledby="files-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="files-h" className="text-[22px]">Logos and designs</h2><p className="text-[14px] text-muted">{assets.length} of {MAX_ASSETS}</p></div>
        {assets.length === 0 ? (
          <p className="text-muted">Nothing here yet. Add your logo, or save a design you approved before, and use it again in one tap.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {assets.map((a) => (
              <li key={a.id} className="grid content-start gap-2 rounded-md2 border border-line p-3">
                <a href={`/api/brand-assets/${a.id}`} target="_blank" rel="noopener noreferrer" className="grid aspect-[4/3] place-items-center overflow-hidden rounded-sm2 bg-paper2" aria-label={`Open ${a.title}`}>
                  {a.has_thumb
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`/api/brand-assets/${a.id}?size=thumb`} alt="" className="h-full w-full object-contain" loading="lazy" />
                    : <span className="text-[14px] font-bold">PDF</span>}
                </a>
                <div className="min-w-0"><p className="truncate font-bold leading-tight">{a.title}</p><p className="text-[13px] text-muted">{KIND_LABEL[a.kind]} · {size(a.bytes)}</p></div>
                {!shared && <form action={deleteAssetAction}><input type="hidden" name="id" value={a.id} /><button className="btn-ghost btn-sm !px-0 underline" aria-label={`Remove ${a.title}`}>Remove</button></form>}
              </li>
            ))}
          </ul>
        )}
        {!shared && <AssetUploader room={MAX_ASSETS - assets.length} maxMb={MAX_ASSET_MB} />}
        {savable.length > 0 && (
          <div className="grid gap-2">
            <h3 className="text-[18px]">Save a design from a past order</h3>
            <ul className="grid gap-2">
              {savable.map((o) => (
                <li key={o.token} className="flex flex-wrap items-center justify-between gap-2 rounded-md2 border border-line p-3">
                  <span className="min-w-0"><span className="block truncate font-bold">{o.name}</span><span className="block text-[13px] text-muted">Order {o.code}</span></span>
                  <form action={saveDesignAction}><input type="hidden" name="token" value={o.token} /><button className="btn-secondary btn-sm">Save to my kit</button></form>
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-muted">ID card files are never saved here, because they hold people&apos;s details.</p>
          </div>
        )}
      </section>
      <p className="text-[14px] text-muted">You can remove any of this at any time. If you delete your account, your brand kit goes with it.</p>
    </div>
  );
}
