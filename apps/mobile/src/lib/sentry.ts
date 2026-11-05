import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { scrubBreadcrumb, scrubSentryEvent } from '@loopfield/core';
import { env } from '@/config/env';

/** Crash and performance monitoring; replay disabled; every event scrubbed before it leaves the device. */
export function initSentry(): void {
  if (!env.sentryDsn) return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.appEnv,
    release: `loopfield@${Constants.expoConfig?.version ?? '0.0.0'}`,
    tracesSampleRate: env.appEnv === 'production' ? 0.05 : 0.3,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    sendDefaultPii: false,
    enableAutoSessionTracking: true,
    beforeSend: (event) => scrubSentryEvent(event as never),
    beforeSendTransaction: (event) => scrubSentryEvent(event as never),
    beforeBreadcrumb: (b) => scrubBreadcrumb(b as Record<string, unknown>) as never
  });
}

export function setMonitoringUser(id: string | null): void {
  Sentry.setUser(id ? { id } : null);
}

export { Sentry };
