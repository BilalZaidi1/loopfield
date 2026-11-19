import { site, type StoreState } from '@/config/site';

export type Platform = 'ios' | 'android' | 'desktop';
export type StorePlatform = Exclude<Platform, 'desktop'>;

/**
 * Apple campaign tokens (ct) are up to 30 characters of letters, digits, spaces and a little punctuation; a space
 * can't start or end one. Google's UTM values get the same cleaning so both stores report the same names.
 */
export function campaignToken(raw: string | null | undefined): string {
  const cleaned = (raw ?? '')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .trim()
    .slice(0, 30)
    .trim();
  return cleaned || 'site';
}

/**
 * The App Store product page. Campaign parameters need the provider token (pt), which App Store Connect only hands
 * out once the app has analytics data, so links start plain and gain pt/ct later.
 */
export function appStoreUrl(appId: string, campaign?: { providerToken: string; name: string }): string | null {
  if (!/^\d{5,}$/.test(appId)) return null;
  const url = new URL(`https://apps.apple.com/app/id${appId}`);
  if (campaign?.providerToken) {
    url.searchParams.set('pt', campaign.providerToken);
    url.searchParams.set('ct', campaignToken(campaign.name));
    url.searchParams.set('mt', '8');
  }
  return url.toString();
}

const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** The Google Play listing, with UTM values in the install referrer so Play Console can report them. */
export function playStoreUrl(packageName: string, campaign?: { name: string; medium?: string }): string | null {
  if (!ANDROID_PACKAGE.test(packageName)) return null;
  const url = new URL('https://play.google.com/store/apps/details');
  url.searchParams.set('id', packageName);
  if (campaign) {
    const referrer = new URLSearchParams({
      utm_source: 'site',
      utm_medium: campaignToken(campaign.medium ?? 'web'),
      utm_campaign: campaignToken(campaign.name)
    });
    url.searchParams.set('referrer', referrer.toString());
  }
  return url.toString();
}

/** iPadOS reports itself as a Mac, so a touch-capable "MacIntel" counts as iOS. */
export function detectPlatform(userAgent: string, maxTouchPoints = 0, platform = ''): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}

export function storeState(p: StorePlatform): StoreState {
  return p === 'ios' ? site.ios.state : site.android.state;
}

/** Where a store button lands, or null while that store has no page yet (the visitor goes to the waitlist). */
export function storeLink(p: StorePlatform, campaign: string): string | null {
  if (p === 'ios') {
    if (site.ios.state === 'waitlist') return null;
    return appStoreUrl(
      site.ios.appId,
      site.ios.providerToken ? { providerToken: site.ios.providerToken, name: campaign } : undefined
    );
  }
  if (site.android.state === 'waitlist') return null;
  return playStoreUrl(site.android.packageName, { name: campaign, medium: 'web' });
}

/** Every store button and QR code goes through /get, which picks the store and records the click. */
export function getHref(placement: string, p?: StorePlatform): string {
  const params = new URLSearchParams({ c: campaignToken(placement) });
  if (p) params.set('p', p);
  return `/get?${params.toString()}`;
}

/** True when no store has a page yet, so the page offers the waitlist instead of store buttons. */
export function waitlistOnly(): boolean {
  return site.ios.state === 'waitlist' && site.android.state === 'waitlist';
}

/** One label for buttons that serve both stores (header, sticky bar): the shared state, or "mixed". */
export function overallState(): StoreState | 'mixed' {
  return site.ios.state === site.android.state ? site.ios.state : 'mixed';
}
