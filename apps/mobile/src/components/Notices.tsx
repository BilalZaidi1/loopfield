import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { PAUSED_TEXT, useFeature, type SwitchKey } from '@/lib/appConfig';
import { useSession } from '@/state/session';
import { ArrowLink, Banner, Button, Card, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { spacing, usePalette } from '@/theme/tokens';

/** Shown in place of an entry point while the back office has its feature switched off. */
export function PausedNote({ feature, text }: { feature: SwitchKey; text?: string }) {
  return <Banner tone="info" text={text ?? PAUSED_TEXT[feature]} />;
}

/** The note for a feature only while it is paused, so callers can drop it in next to the entry point. */
export function PausedIfOff({ feature, text }: { feature: SwitchKey; text?: string }) {
  const on = useFeature(feature);
  return on ? null : <PausedNote feature={feature} text={text} />;
}

export type SupportCategory = 'bug' | 'feedback' | 'account' | 'competition' | 'safety' | 'billing' | 'other';

/** Opens a new support message with its category, subject and context filled in. */
export function supportHref(category: SupportCategory, subject: string, context?: string): Href {
  return { pathname: '/support/new', params: { category, subject, ...(context ? { context } : {}) } };
}

export function contactSupport(category: SupportCategory, subject: string, context?: string): void {
  router.push(supportHref(category, subject, context));
}

/** "Contact support" as a quiet link under an explanation (a run that did not count, an error). */
export function ContactSupportLink({ category, subject, context, label = 'Contact support' }: { category: SupportCategory; subject: string; context?: string; label?: string }) {
  return <ArrowLink label={label} onPress={() => contactSupport(category, subject, context)} accessibilityLabel={`${label}: ${subject}`} />;
}

export function isSuspended(status: string | null | undefined): boolean {
  return status === 'suspended';
}

/** True while the signed-in account is suspended (competing, posting and messaging are blocked on the server). */
export function useSuspended(): boolean {
  return isSuspended(useSession().profile?.status);
}

const BLOCKED: Record<'account' | 'compete' | 'post' | 'message' | 'comment' | 'club', string> = {
  account: 'Competing, posting and messaging are paused while your account is suspended. You can still record private runs.',
  compete: 'Competing is paused while your account is suspended. You can still record private runs.',
  post: 'Posting is paused while your account is suspended.',
  comment: 'Commenting is paused while your account is suspended.',
  message: 'Messaging is paused while your account is suspended.',
  club: 'Creating and managing clubs is paused while your account is suspended.'
};

/** Opens the request for a review of the runner's own suspension (one per suspension). */
export function appealSuspension(userId: string | null): void {
  if (userId) router.push({ pathname: '/appeals', params: { type: 'account_action', id: userId } });
  else router.push('/appeals');
}

/**
 * The suspended state, where an action is blocked: what is paused, what still works, and where to go.
 * Suspended runners can still record privately, see their history, message support and ask for a
 * review of the suspension.
 */
export function SuspendedNotice({ what, compact }: { what: keyof typeof BLOCKED; compact?: boolean }) {
  const p = usePalette();
  const { userId } = useSession();
  if (compact) {
    return <Banner tone="warning" text={BLOCKED[what]} action={{ label: 'Get help', onPress: () => contactSupport('account', 'My account is suspended', 'account:suspended') }} />;
  }
  return (
    <Card accessibilityLabel="Your account is suspended">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="lock" color={p.warning} size={22} />
        <Txt variant="heading" style={{ flex: 1 }}>Your account is suspended</Txt>
      </View>
      <Txt color="textMuted">{`${BLOCKED[what]} Your runs and history are safe.`}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Button size="sm" icon="chat" label="Message support" onPress={() => contactSupport('account', 'My account is suspended', 'account:suspended')} />
        <Button size="sm" variant="secondary" icon="flag" label="Ask for a review" onPress={() => appealSuspension(userId)} accessibilityLabel="Ask for a review of your suspension" />
      </View>
    </Card>
  );
}
