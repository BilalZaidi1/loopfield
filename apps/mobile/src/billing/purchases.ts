import { Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Purchases, { type PurchasesOffering, type PurchasesPackage } from 'react-native-purchases';
import { env } from '@/config/env';
import { callFunction } from '@/lib/api';
import { track } from '@/lib/analytics';
import { log } from '@/lib/log';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/state/session';

/**
 * RevenueCat client. The app never decides entitlements: after a purchase or restore it asks the
 * backend to reconcile from RevenueCat's REST API, and reads `public.entitlements` (written only by
 * the service role). The first release is a free pilot: `paywall_enabled=false` gates nothing.
 */
let configured = false;

function apiKey(): string | undefined {
  return Platform.OS === 'ios' ? env.revenueCatIosKey : Platform.OS === 'android' ? env.revenueCatAndroidKey : undefined;
}

export function purchasesConfigured(): boolean {
  if (configured) return true;
  const key = apiKey();
  if (!key) return false;
  try {
    Purchases.configure({ apiKey: key });
    configured = true;
  } catch (e) {
    log.warn(`purchases configure failed: ${String(e)}`);
  }
  return configured;
}

export async function purchasesLogIn(userId: string): Promise<void> {
  if (!purchasesConfigured()) return;
  await Purchases.logIn(userId).catch((e) => log.warn(`purchases login failed: ${String(e)}`));
}

export async function purchasesLogOut(): Promise<void> {
  if (!configured) return;
  if (await Purchases.isAnonymous()) return;
  await Purchases.logOut();
}

export async function currentOffering(): Promise<PurchasesOffering | null> {
  if (!purchasesConfigured()) return null;
  const o = await Purchases.getOfferings();
  return o.current ?? null;
}

async function reconcile(): Promise<void> {
  await callFunction('billing-sync', {}).catch((e) => log.warn(`billing sync request failed: ${String(e)}`));
}

export async function purchase(pkg: PurchasesPackage): Promise<'purchased' | 'cancelled'> {
  track('purchase_started', { package_type: pkg.packageType === 'MONTHLY' ? 'monthly' : pkg.packageType === 'ANNUAL' ? 'annual' : 'other' });
  try {
    await Purchases.purchasePackage(pkg);
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) return 'cancelled';
    throw e;
  }
  await reconcile();
  return 'purchased';
}

export async function restore(): Promise<'restored' | 'nothing_to_restore'> {
  try {
    const info = await Purchases.restorePurchases();
    const any = Object.keys(info.entitlements.active).length > 0;
    await reconcile();
    track('restore_completed', { outcome: any ? 'restored' : 'nothing_to_restore' });
    return any ? 'restored' : 'nothing_to_restore';
  } catch (e) {
    track('restore_completed', { outcome: 'failed' });
    throw e;
  }
}

export async function manageSubscription(): Promise<void> {
  if (!purchasesConfigured()) return;
  await Purchases.showManageSubscriptions();
}

export interface Entitlement {
  entitlement: string;
  is_active: boolean;
  status: string;
  product_id: string | null;
  store: string | null;
  period_type: string | null;
  expires_at: string | null;
  grace_expires_at: string | null;
  will_renew: boolean;
  billing_issue_at: string | null;
}

export interface BillingConfig {
  paywallEnabled: boolean;
  premiumFeatures: string[];
}

export function useBillingConfig() {
  return useQuery({
    queryKey: ['app_config', 'billing'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BillingConfig> => {
      const { data, error } = await supabase().from('app_config').select('key, value').in('key', ['paywall_enabled', 'premium_features']);
      if (error) throw error;
      const m = new Map((data ?? []).map((r) => [r.key as string, r.value as unknown]));
      return { paywallEnabled: m.get('paywall_enabled') === true, premiumFeatures: (m.get('premium_features') as string[] | undefined) ?? [] };
    }
  });
}

export function useEntitlements() {
  const { userId } = useSession();
  return useQuery({
    queryKey: ['entitlements', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Entitlement[]> => {
      const { data, error } = await supabase().from('entitlements').select('*').eq('user_id', userId!);
      if (error) throw error;
      return (data ?? []) as Entitlement[];
    }
  });
}

/** Core competition, social, health, privacy and deletion are never listed as premium (server-enforced config). */
export function useFeatureAccess(featureKey: string): { allowed: boolean; loading: boolean } {
  const cfg = useBillingConfig();
  const ent = useEntitlements();
  if (cfg.isLoading) return { allowed: true, loading: true };
  const c = cfg.data;
  if (!c || !c.paywallEnabled || !c.premiumFeatures.includes(featureKey)) return { allowed: true, loading: false };
  return { allowed: Boolean(ent.data?.some((e) => e.entitlement === 'premium' && e.is_active)), loading: ent.isLoading };
}
