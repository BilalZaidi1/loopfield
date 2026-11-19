'use client';

import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { keepCampaignParams } from '@/lib/insights';

/**
 * Vercel Web Analytics (cookieless page views) and Speed Insights (real-user Core Web Vitals) on every page. Both
 * scripts are served from this origin, and both get the page address with only its utm_ tags.
 */
export function VercelInsights() {
  return (
    <>
      <Analytics beforeSend={(event) => ({ ...event, url: keepCampaignParams(event.url) })} />
      <SpeedInsights beforeSend={(event) => ({ ...event, url: keepCampaignParams(event.url) })} />
    </>
  );
}
