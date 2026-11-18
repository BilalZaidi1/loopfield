import { Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { env } from '@/config/env';

/** True when `current` is an older version than `target` (major.minor.patch; missing parts count as 0). */
export function versionBelow(current: string, target: string): boolean {
  const a = current.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const b = target.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

/**
 * The installed app's version: the store version of the native build (updates over the air never change
 * it), or the app config's version where there is no native build (the browser).
 */
export function installedVersion(): string {
  return (Platform.OS !== 'web' ? Application.nativeApplicationVersion : null) ?? Constants.expoConfig?.version ?? '0.0.0';
}

/** The over-the-air update this app is running (its first 8 characters), or null for the code built into the app. */
export function runningUpdate(): string | null {
  try {
    return Updates.updateId && !Updates.isEmbeddedLaunch ? Updates.updateId.slice(0, 8) : null;
  } catch {
    return null;
  }
}

/** The store page for this app, or null where there is no store (the browser). */
export function storeUrl(): string | null {
  if (Platform.OS === 'android') {
    const id = Application.applicationId;
    return id ? `market://details?id=${id}` : null;
  }
  if (Platform.OS === 'ios') {
    return env.iosAppStoreId ? `itms-apps://apps.apple.com/app/id${env.iosAppStoreId}` : 'itms-apps://apps.apple.com/';
  }
  return null;
}

/** The web address of the same store page, when the store app cannot be opened. */
export function storeWebUrl(): string | null {
  if (Platform.OS === 'android') return Application.applicationId ? `https://play.google.com/store/apps/details?id=${Application.applicationId}` : null;
  if (Platform.OS === 'ios') return env.iosAppStoreId ? `https://apps.apple.com/app/id${env.iosAppStoreId}` : 'https://apps.apple.com/';
  return null;
}
