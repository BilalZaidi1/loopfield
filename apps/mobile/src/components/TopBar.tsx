import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { useSession } from '@/state/session';
import { useSignedUrl } from '@/features/social/media';
import { spacing, TOUCH, usePalette } from '@/theme/tokens';
import { Icon, type IconName } from './icons';
import { Avatar, Txt } from './ui';

export interface BadgeCounts {
  notifications: number;
  follow_requests: number;
  club_invites: number;
}

export function useBadgeCounts() {
  const { userId } = useSession();
  return useQuery({ queryKey: ['badge_counts', userId], enabled: Boolean(userId), refetchInterval: 60_000, queryFn: () => rpc<BadgeCounts>('badge_counts') });
}

function IconButton({ name, label, count, onPress }: { name: IconName; label: string; count?: number; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={count ? `${label}, ${count} unread` : label} style={{ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} color={p.text} />
      {count ? (
        <View style={{ position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: p.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Txt variant="caption" style={{ color: '#FFFFFF', fontSize: 11, lineHeight: 14 }}>{count > 99 ? '99+' : String(count)}</Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Tab header with avatar menu (profile, settings), inbox and notifications entry points. */
export function TopBar({ title, showSocial = true }: { title: string; showSocial?: boolean }) {
  const { profile } = useSession();
  const avatar = useSignedUrl('avatars', profile?.avatar_path);
  const badges = useBadgeCounts();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
      <Pressable onPress={() => router.push('/me')} accessibilityRole="button" accessibilityLabel="Your profile and settings" style={{ minHeight: TOUCH, justifyContent: 'center' }}>
        <Avatar name={profile?.display_name ?? 'You'} uri={avatar.data} size={36} />
      </Pressable>
      <Txt variant="title" style={{ flex: 1, marginLeft: spacing.sm }}>{title}</Txt>
      {showSocial ? (
        <>
          <IconButton name="search" label="Discover runners and communities" onPress={() => router.push('/discover')} />
          <IconButton name="chat" label="Messages" onPress={() => router.push('/inbox')} />
          <IconButton name="bell" label="Notifications" count={(badges.data?.notifications ?? 0) + (badges.data?.follow_requests ?? 0)} onPress={() => router.push('/notifications')} />
        </>
      ) : null}
    </View>
  );
}
