import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A self-contained server bundle: what the Dockerfile ships.
  output: 'standalone',
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'pdf-lib', 'image-size', 'qrcode', 'sharp', 'fontkit'],
  // Brandit Studio sets customers' words in real font files. They are read from disk at run time, so they must ship with the server bundle.
  outputFileTracingIncludes: { '/**': ['./studio-assets/**/*'] },
  webpack: (config) => {
    // The "@/..." import alias, defined here so the build never depends on tsconfig being read.
    config.resolve.alias = { ...config.resolve.alias, '@': root };
    return config;
  },
  async headers() {
    return [
      {
        // The service worker must always be fetched fresh, so an update reaches phones the same day.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Content-Type', value: 'text/javascript; charset=utf-8' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self)' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};
export default nextConfig;
