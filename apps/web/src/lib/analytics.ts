import type { PostHog } from 'posthog-js';
import { site } from '@/config/site';

/**
 * PostHog EU in cookieless mode: nothing is stored in the browser, no autocapture, no session replay, no
 * identify. Only the events below are sent, with coarse properties, the same allowlist approach as the app.
 * Nothing loads unless NEXT_PUBLIC_POSTHOG_KEY is set, and the project needs PostHog's
 * "Enable cookieless tracking" setting turned on.
 */
export type SiteEvent =
  | { name: 'section_view'; props: { section: string } }
  | { name: 'store_click'; props: { platform: string; placement: string; state: string } }
  | { name: 'draw_loop_complete'; props: { cells: string; mode: 'drawn' | 'auto' } }
  | { name: 'waitlist_submit'; props: { country: string } }
  | { name: 'faq_open'; props: { question: string } };

let client: PostHog | null = null;
let loading = false;
const queue: SiteEvent[] = [];

export function initAnalytics(): void {
  if (!site.posthogKey || typeof window === 'undefined' || loading || client) return;
  loading = true;
  void import('posthog-js').then(({ default: posthog }) => {
    posthog.init(site.posthogKey, {
      api_host: 'https://eu.i.posthog.com',
      cookieless_mode: 'always',
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true
    });
    client = posthog;
    for (const e of queue.splice(0)) client.capture(e.name, e.props);
  });
}

export function track<E extends SiteEvent>(name: E['name'], props: E['props']): void {
  if (!site.posthogKey) return;
  const event = { name, props } as SiteEvent;
  if (client) client.capture(event.name, event.props);
  else queue.push(event);
}

/** Bucket a count so no exact values are sent: 1–9, 10–24, 25–49, 50+. */
export function bucket(n: number): string {
  if (n < 10) return '1-9';
  if (n < 25) return '10-24';
  if (n < 50) return '25-49';
  return '50+';
}
