/**
 * Everything that changes between now and launch lives here: the name (still a working name pending trademark
 * clearance), the domain, each store's state and IDs, and the contact details. Values come from NEXT_PUBLIC_*
 * environment variables, which Next inlines at build time; the defaults are safe for a site with no store listings.
 */
export type StoreState = 'waitlist' | 'preorder' | 'live';

const storeState = (value: string | undefined): StoreState =>
  value === 'live' || value === 'preorder' || value === 'waitlist' ? value : 'waitlist';

/** On Vercel the project's production domain is known at build time, so the canonical URL needs no setting there. */
const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const site = {
  name: 'Loopfield',
  url: (process.env.NEXT_PUBLIC_SITE_URL || (vercelProduction ? `https://${vercelProduction}` : 'http://localhost:3200')).replace(/\/$/, ''),
  publisher: process.env.NEXT_PUBLIC_PUBLISHER ?? 'Loopfield',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@example.com',
  ios: {
    state: storeState(process.env.NEXT_PUBLIC_IOS_STATE),
    /** The numeric Apple ID App Store Connect assigns when the app record is created. */
    appId: process.env.NEXT_PUBLIC_IOS_APP_ID ?? '',
    /** Provider token (pt) from App Store Connect's first campaign link; only exists once the app has analytics data. */
    providerToken: process.env.NEXT_PUBLIC_APPLE_PROVIDER_TOKEN ?? '',
    /** apps/mobile/app.config.ts: ios.deploymentTarget. The app is iPhone-only (supportsTablet: false). */
    minOs: '16.4'
  },
  android: {
    state: storeState(process.env.NEXT_PUBLIC_ANDROID_STATE),
    /** apps/mobile/app.config.ts: APP_BUNDLE_ID defaults to dev.loopfield.app; it can't change once published. */
    packageName: process.env.NEXT_PUBLIC_ANDROID_PACKAGE ?? 'dev.loopfield.app',
    /** minSdkVersion 28 = Android 9. */
    minOs: '9'
  },
  /**
   * Apple's and Google's badges may only be the official artwork. Drop the SVGs from Apple's Marketing Tools and
   * Google's badge generator into public/badges (see the README there) and set NEXT_PUBLIC_OFFICIAL_BADGES=1;
   * until then the buttons are Loopfield's own pills, which carry no Apple or Google marks.
   */
  officialBadges: process.env.NEXT_PUBLIC_OFFICIAL_BADGES === '1',
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''
} as const;

export const requirementsLine = `iPhone with iOS ${site.ios.minOs} or later · Android ${site.android.minOs} or later`;
