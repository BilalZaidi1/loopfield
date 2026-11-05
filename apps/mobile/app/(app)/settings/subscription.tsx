import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { friendlyError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtDate } from '@/lib/format';
import { Badge, Banner, Button, Card, EmptyState, LoadingState, Screen, Section, Txt } from '@/components/ui';
import { currentOffering, manageSubscription, purchase, purchasesConfigured, restore, useBillingConfig, useEntitlements } from '@/billing/purchases';

/**
 * P2 subscription screen (FR28), off by default: `paywall_enabled=false` keeps the free pilot, and no
 * core competition, social, health, privacy or deletion feature can be made premium.
 */
export default function Subscription() {
  const cfg = useBillingConfig();
  const ents = useEntitlements();
  const [busy, setBusy] = useState<string | null>(null);
  const offering = useQuery({ queryKey: ['rc_offering'], enabled: purchasesConfigured(), queryFn: currentOffering });
  useEffect(() => {
    if (cfg.data) track('paywall_viewed', { source: 'settings', paywall_enabled: cfg.data.paywallEnabled });
  }, [cfg.data]);
  if (cfg.isLoading) return <LoadingState />;
  const ent = ents.data?.find((e) => e.entitlement === 'premium');
  const stateLabel = !ent ? 'No subscription' : ent.status === 'grace' ? 'Active — billing issue (grace period)' : ent.status === 'billing_issue' ? 'Billing issue' : ent.is_active ? (ent.will_renew ? 'Active' : 'Active until expiry') : ent.status === 'refunded' ? 'Refunded' : 'Expired';

  const buy = async (pkgId: string) => {
    const pkg = offering.data?.availablePackages.find((p) => p.identifier === pkgId);
    if (!pkg) return;
    setBusy(pkgId);
    try {
      const r = await purchase(pkg);
      if (r === 'purchased') Alert.alert('Thank you', 'Your purchase is being confirmed with the store. Access updates in a moment.');
      void ents.refetch();
    } catch (e) {
      Alert.alert('Purchase not completed', friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Subscription' }} />
      {!cfg.data?.paywallEnabled ? <Banner tone="success" text="Free pilot: every feature is included. Paid plans are not on sale." /> : null}
      <Card tone={ent?.is_active ? 'violet' : 'surface'} accessibilityLabel="Your plan">
        <Txt variant="heading">Your plan</Txt>
        <Badge label={stateLabel} tone={ent?.is_active ? 'success' : 'muted'} />
        {ent?.expires_at ? <Txt variant="caption">{ent.will_renew ? 'Renews' : 'Ends'} {fmtDate(ent.expires_at)}{ent.grace_expires_at ? ` · grace period until ${fmtDate(ent.grace_expires_at)}` : ''}</Txt> : null}
        {ent?.status === 'grace' || ent?.status === 'billing_issue' ? <Txt color="warning">Update your payment method in the store to keep access.</Txt> : null}
        <Txt variant="caption">Status is confirmed by our server with the app store; this screen never grants access by itself.</Txt>
      </Card>
      {cfg.data?.paywallEnabled ? (
        !purchasesConfigured() ? <EmptyState icon="star" title="Purchases are not configured in this build" /> : offering.isLoading ? <LoadingState /> : offering.data ? (
          <Section title="Plans" icon="star">
            {offering.data.availablePackages.map((p) => (
              <Card key={p.identifier}>
                <Txt variant="heading">{p.product.title}</Txt>
                <Txt>{p.product.priceString}{p.packageType === 'MONTHLY' ? ' per month' : p.packageType === 'ANNUAL' ? ' per year' : ''}</Txt>
                {p.product.description ? <Txt variant="caption">{p.product.description}</Txt> : null}
                <Button label="Subscribe" arrow onPress={() => void buy(p.identifier)} loading={busy === p.identifier} disabled={Boolean(ent?.is_active)} />
              </Card>
            ))}
          </Section>
        ) : <EmptyState icon="star" title="No plans available right now" />
      ) : null}
      {purchasesConfigured() ? (
        <>
          <Button variant="secondary" label="Restore purchases" onPress={() => void restore().then((r) => Alert.alert(r === 'restored' ? 'Purchases restored' : 'Nothing to restore')).catch((e) => Alert.alert('Restore failed', friendlyError(e)))} />
          {ent ? <Button variant="ghost" label="Manage in the store" onPress={() => void manageSubscription()} /> : null}
        </>
      ) : null}
    </Screen>
  );
}
