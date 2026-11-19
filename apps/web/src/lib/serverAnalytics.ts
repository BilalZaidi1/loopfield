import 'server-only';

/**
 * Server-side events, so store clicks count even when the visitor's browser blocks scripts. Same cookieless rules
 * as the page: a random id per event and no person profiles.
 */
export async function captureServer(event: 'store_redirect', properties: Record<string, string>): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;
  try {
    await fetch('https://eu.i.posthog.com/i/v0/e/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: crypto.randomUUID(),
        properties: { ...properties, $process_person_profile: false }
      }),
      signal: AbortSignal.timeout(3000)
    });
  } catch {
    // Analytics never blocks a redirect.
  }
}
