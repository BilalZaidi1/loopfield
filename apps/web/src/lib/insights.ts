/**
 * The page address Vercel Web Analytics and Speed Insights receive: utm_ campaign tags kept, every other query
 * parameter and the fragment dropped. The waitlist confirmation link's token carries the address it was sent to.
 */
export function keepCampaignParams(href: string): string {
  try {
    const url = new URL(href);
    for (const key of [...url.searchParams.keys()]) if (!key.startsWith('utm_')) url.searchParams.delete(key);
    url.hash = '';
    return url.toString();
  } catch {
    return href.split(/[?#]/)[0] ?? href;
  }
}
