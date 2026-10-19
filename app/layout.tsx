import type { Metadata, Viewport } from 'next';
// Fonts are served from our own domain: one fewer connection on mobile data, and nothing blocks if Google is slow.
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/dm-sans/wght.css';
import './globals.css';
import { isStaging } from '@/lib/envcheck';

const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(base),
  title: { default: 'Brandit: printing without the hassle', template: '%s | Brandit' },
  description: 'Design and print in Lagos. See your price and your delivery time before you pay. Upload a file or let us design it.',
  applicationName: 'Brandit',
  manifest: '/manifest.webmanifest',
  openGraph: { siteName: 'Brandit', type: 'website', locale: 'en_NG', title: 'Brandit: printing without the hassle', description: 'Design and print in Lagos. Your price and delivery time, before you pay.' },
  twitter: { card: 'summary_large_image' },
  appleWebApp: { capable: true, title: 'Brandit', statusBarStyle: 'black-translucent' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0B1F33', viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <body>
        {isStaging(process.env) && <div role="status" className="bg-accent px-3 py-1 text-center text-[13px] font-bold text-ink">Test site: nothing here is real. Payments are test payments and orders are not made.</div>}
        {children}
      </body>
    </html>
  );
}
