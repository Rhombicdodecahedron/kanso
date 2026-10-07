import type { NextConfig } from 'next';

// Extension bundles run through `new Function` and SQLite is WebAssembly, hence the eval allowances.
// Covers and pages come through /api/img (same origin) or blob: URLs for downloads.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

const config: NextConfig = {
  transpilePackages: ['@kanso/core', '@kanso/sqlite', '@kanso/source-gateway', '@kanso/transport', '@kanso/http', '@kanso/source-api'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      // The service worker must be revalidated, or browsers keep an old one for up to a day.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};

export default config;
