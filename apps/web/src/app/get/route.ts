import { after, NextResponse, type NextRequest } from 'next/server';
import { campaignToken, detectPlatform, storeLink } from '@/lib/stores';
import { captureServer } from '@/lib/serverAnalytics';

/**
 * Every store button, QR code, bio link and shared run that needs the app lands here. It picks the store from the
 * button (?p=) or the visitor's phone, adds the campaign, records the click on the server and redirects. Desktops,
 * and stores that have no page yet, go to the download section of the home page.
 */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const campaign = campaignToken(params.get('c'));
  const asked = params.get('p');
  const platform = asked === 'ios' || asked === 'android' ? asked : detectPlatform(request.headers.get('user-agent') ?? '');
  const store = platform === 'desktop' ? null : storeLink(platform, campaign);
  const destination = store ?? new URL('/#download', request.url).toString();

  after(() => captureServer('store_redirect', { platform, campaign, destination: store ? 'store' : 'site' }));

  const response = NextResponse.redirect(destination, 302);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex');
  return response;
}
