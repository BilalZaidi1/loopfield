import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { env } from '@/config/env';
import type { Database } from './database.types';

/**
 * Session storage in the platform keychain/keystore. Sessions can exceed SecureStore's per-item size
 * guidance, so values are split into chunks under derived keys.
 */
const CHUNK = 1800;
const chunkKey = (key: string, i: number) => `${key.replace(/[^A-Za-z0-9._-]/g, '_')}.${i}`;

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = Number((await SecureStore.getItemAsync(chunkKey(key, 0) + '.n')) ?? '0');
    if (!count) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part == null) return null;
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    await this.removeItem(key);
    const count = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < count; i++) await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(chunkKey(key, 0) + '.n', String(count));
  },
  async removeItem(key: string): Promise<void> {
    const count = Number((await SecureStore.getItemAsync(chunkKey(key, 0) + '.n')) ?? '0');
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(chunkKey(key, i));
    await SecureStore.deleteItemAsync(chunkKey(key, 0) + '.n');
  }
};

let client: SupabaseClient<Database> | null = null;

/** Typed client: table, column and RPC names are checked against the generated schema types. */
export function supabase(): SupabaseClient<Database> {
  if (!client) {
    if (!env.supabaseUrl || !env.supabaseAnonKey) throw new Error('Supabase is not configured (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY).');
    client = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
      // Phones keep the session in the keychain/keystore; the browser version uses the browser's own storage.
      auth: { storage: Platform.OS === 'web' ? undefined : secureSessionStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' }
    });
    // Refresh tokens only while the app is in the foreground (Supabase React Native guidance).
    AppState.addEventListener('change', (state) => {
      if (state === 'active') client?.auth.startAutoRefresh();
      else client?.auth.stopAutoRefresh();
    });
  }
  return client;
}
