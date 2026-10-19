import type { MetadataRoute } from 'next';
import { isStaging } from '@/lib/envcheck';
export const dynamic = 'force-dynamic'; // read the site address when asked, not when built
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  // The private test copy asks every search engine to stay away.
  if (isStaging(process.env)) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/console', '/api/', '/account', '/checkout/', '/order/', '/pay/', '/track/', '/proof/', '/invoice/', '/welcome', '/signin', '/studio/new', '/studio/p/', '/studio/projects', '/studio/share/', '/studio/pay/'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
