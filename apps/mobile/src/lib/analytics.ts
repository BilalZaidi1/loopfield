import { Platform } from 'react-native';
import PostHog from 'posthog-react-native';
import { sanitizeEvent, type AnalyticsEventName, type AnalyticsProps } from '@loopfield/core';
import { env } from '@/config/env';
import { log } from './log';

/**
 * Product analytics through an explicit, allowlisted schema (packages/core analytics/events.ts).
 * Autocapture, screen capture, lifecycle events and session replay are disabled; no raw GPS, health
 * readings, message text, auth details or free text can be sent. Identity is the internal user id only.
 */
let client: PostHog | null = null;
let enabled = false;

/** Pages for people who don't use Loopfield (a live link, a shared run) load no analytics at all. */
export function onPublicPage(pathname: string | null | undefined = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location?.pathname : null): boolean {
  return /^\/(l|a)\/[^/]+\/?$/.test(pathname ?? '');
}

export function initAnalytics(): void {
  if (client || !env.posthogKey || onPublicPage()) return;
  client = new PostHog(env.posthogKey, {
    host: env.posthogHost,
    captureAppLifecycleEvents: false,
    enableSessionReplay: false,
    persistence: 'file',
    defaultOptIn: false,
    personProfiles: 'identified_only',
    flushAt: 20,
    disableGeoip: true
  } as never);
}

export async function setAnalyticsConsent(granted: boolean): Promise<void> {
  enabled = granted;
  if (!client) return;
  if (granted) await client.optIn();
  else await client.optOut();
}

export function identify(userId: string, props: Record<string, string | boolean> = {}): void {
  if (!client || !enabled) return;
  client.identify(userId, props);
}

export function track<E extends AnalyticsEventName>(event: E, props: AnalyticsProps<E> = {} as AnalyticsProps<E>): void {
  if (!client || !enabled) return;
  try {
    const clean = sanitizeEvent(event, props);
    if (clean.dropped.length && __DEV__) log.warn(`analytics dropped props for ${event}: ${clean.dropped.join(',')}`);
    client.capture(clean.event, clean.properties);
  } catch (e) {
    log.error('analytics event rejected', e);
  }
}

/** Logout: forget the identity so the next user is never merged with the previous one. */
export function resetAnalytics(): void {
  client?.reset();
}
