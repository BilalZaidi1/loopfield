import type { NextConfig } from 'next';

/*
 * Strict CSP: only our own code, PostHog EU (when a key is set), and Vercel Web Analytics and Speed Insights, which
 * are served from this origin. No other third-party scripts; three.js is bundled.
 */
// Preview deployments also allow Vercel's toolbar, so reviewers can leave comments on a preview link.
const toolbar = process.env.VERCEL_ENV === 'preview';
const vercelLive = (sources: string) => (toolbar ? ` ${sources}` : '');

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '') + vercelLive('https://vercel.live'),
  "style-src 'self' 'unsafe-inline'" + vercelLive('https://vercel.live'),
  "img-src 'self' data: blob:" + vercelLive('https://vercel.live https://vercel.com'),
  "font-src 'self' data:" + vercelLive('https://vercel.live https://assets.vercel.com'),
  "connect-src 'self' https://eu.i.posthog.com" + vercelLive('https://vercel.live wss://ws-us3.pusher.com'),
  "frame-src" + (toolbar ? ' https://vercel.live' : " 'none'"),
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // three ships untranspiled add-ons (React Three Fiber's Next.js guide).
  transpilePackages: ['three'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' }
        ]
      }
    ];
  }
};

export default nextConfig;
