import type { MetadataRoute } from 'next';
import { listProducts } from '@/lib/catalog';
import { liveCampaigns } from '@/lib/campaigns';
import { listTemplates } from '@/lib/templates';
import { getSettings } from '@/lib/settings';
import { runnable } from '@/lib/studio/config';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const [products, seasons, templates, settings] = await Promise.all([listProducts(), liveCampaigns(), listTemplates(), getSettings()]);
  const studio = settings.studio_enabled && runnable() && settings.studio_access === 'everyone';
  return [
    { url: `${base}/`, priority: 1 },
    { url: `${base}/products`, priority: 0.9 },
    ...products.map((p) => ({ url: `${base}/products/${p.slug}`, priority: 0.8 })),
    { url: `${base}/templates`, priority: 0.8 },
    ...templates.map((t) => ({ url: `${base}/templates/${t.slug}`, priority: 0.6 })),
    ...seasons.map((c) => ({ url: `${base}/season/${c.slug}`, priority: 0.7 })),
    ...(studio ? [{ url: `${base}/studio`, priority: 0.7 }, { url: `${base}/legal/ai-designs`, priority: 0.3 }] : []),
    { url: `${base}/plan-event`, priority: 0.7 },
    { url: `${base}/custom-order`, priority: 0.7 },
    { url: `${base}/business`, priority: 0.6 },
    { url: `${base}/delivery`, priority: 0.6 },
    { url: `${base}/faq`, priority: 0.6 },
    { url: `${base}/help`, priority: 0.5 },
    { url: `${base}/about`, priority: 0.4 },
    { url: `${base}/contact`, priority: 0.4 },
    { url: `${base}/track`, priority: 0.4 },
    { url: `${base}/legal/terms`, priority: 0.2 },
    { url: `${base}/legal/refunds`, priority: 0.2 },
    { url: `${base}/legal/privacy`, priority: 0.2 },
  ];
}
