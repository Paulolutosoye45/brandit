import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Brandit',
    short_name: 'Brandit',
    description: 'Printing without the hassle. Design and print in Lagos, with your price and delivery time before you pay.',
    id: '/',
    start_url: '/?source=pwa',
    scope: '/',
    lang: 'en-NG',
    dir: 'ltr',
    orientation: 'portrait',
    categories: ['business', 'shopping'],
    display: 'standalone',
    background_color: '#F3F5F7',
    theme_color: '#0B1F33',
    shortcuts: [
      { name: 'Start an order', short_name: 'Order', url: '/products', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Track an order', short_name: 'Track', url: '/track', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Plan my event', short_name: 'Event', url: '/plan-event', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Templates', short_name: 'Templates', url: '/templates', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
