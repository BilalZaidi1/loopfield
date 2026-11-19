import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { VercelInsights } from '@/components/VercelInsights';
import { site } from '@/config/site';
import { copy } from '@/content/en';
import './globals.css';

/* Figtree, the app's typeface, self-hosted: body weights, plus the 900 italic of the display lines (preloaded). */
const figtree = localFont({
  src: [
    { path: '../fonts/figtree-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/figtree-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/figtree-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: '../fonts/figtree-latin-800-normal.woff2', weight: '800', style: 'normal' }
  ],
  variable: '--font-figtree',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial'
});

const figtreeDisplay = localFont({
  src: [{ path: '../fonts/figtree-latin-900-italic.woff2', weight: '900', style: 'italic' }],
  variable: '--font-figtree-display',
  display: 'swap',
  preload: true,
  adjustFontFallback: 'Arial'
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: copy.meta.title,
  description: copy.meta.description,
  applicationName: site.name,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: site.name,
    title: copy.meta.title,
    description: copy.meta.description,
    locale: 'en'
  },
  twitter: { card: 'summary_large_image', title: copy.meta.title, description: copy.meta.description },
  formatDetection: { telephone: false, email: false, address: false },
  // The Smart App Banner on iPhone Safari, once the App Store listing is live.
  ...(site.ios.state === 'live' && site.ios.appId ? { itunes: { appId: site.ios.appId } } : {})
};

export const viewport: Viewport = {
  themeColor: '#101114',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

/**
 * Runs before first paint: marks the visitor's phone (so only its store button shows, with no layout shift) and
 * restores the footer's Pause motion choice.
 */
const bootScript = `(function(){try{var d=document.documentElement,n=navigator,u=n.userAgent;d.dataset.platform=/iPhone|iPad|iPod/i.test(u)||(n.platform==='MacIntel'&&n.maxTouchPoints>1)?'ios':/Android/i.test(u)?'android':'desktop';if(localStorage.getItem('lf-motion')==='off')d.dataset.motion='off'}catch(e){}})();`;

/** Without JavaScript, everything that would rise or open in is simply shown. */
const noScriptCss = '.reveal-line>span{transform:none!important}.fade-up{opacity:1!important;transform:none!important}.hex-iris{--iris:1!important}';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${figtreeDisplay.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
        <noscript>
          <style>{noScriptCss}</style>
        </noscript>
      </head>
      <body>
        {children}
        {/* Vercel Web Analytics and Speed Insights, on Vercel deployments only: elsewhere their scripts don't exist. */}
        {process.env.VERCEL ? <VercelInsights /> : null}
      </body>
    </html>
  );
}
