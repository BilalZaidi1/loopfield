import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { useSession } from '@/state/session';
import { useSignedUrl } from '@/features/social/media';
import { spacing, TOUCH } from '@/theme/tokens';
import { Avatar, IconButton, Txt } from './ui';

export interface BadgeCounts {
  notifications: number;
  follow_requests: number;
  club_invites: number;
}

export function useBadgeCounts() {
  const { userId } = useSession();
  return useQuery({ queryKey: ['badge_counts', userId], enabled: Boolean(userId), refetchInterval: 60_000, queryFn: () => rpc<BadgeCounts>('badge_counts') });
}

/**
 * Header for the five main tabs: large title on the left; discover, messages, notifications and your
 * profile on the right (the profile menu holds settings).
 */
export function TopBar({ title, subtitle, showSocial = true }: { title: string; subtitle?: string; showSocial?: boolean }) {
  const { profile } = useSession();
  const avatar = useSignedUrl('avatars', profile?.avatar_path);
  const badges = useBadgeCounts();
  const unread = (badges.data?.notifications ?? 0) + (badges.data?.follow_requests ?? 0);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 56 }}>
      <View style={{ flex: 1, gap: 2 }}>
        {subtitle ? <Txt variant="label" color="textMuted" numberOfLines={1}>{subtitle}</Txt> : null}
        <Txt variant="title" numberOfLines={1}>{title}</Txt>
      </View>
      {showSocial ? (
        <>
          <IconButton icon="search" label="Discover runners and clubs" onPress={() => router.push('/discover')} />
          <IconButton icon="chat" label="Messages" onPress={() => router.push('/inbox')} />
          <IconButton icon="bell" label="Notifications" count={unread} onPress={() => router.push('/notifications')} />
        </>
      ) : null}
      <Pressable onPress={() => router.push('/me')} accessibilityRole="button" accessibilityLabel="Your profile and settings" hitSlop={4} style={({ pressed }) => ({ minHeight: TOUCH, minWidth: TOUCH, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
        <Avatar name={profile?.display_name ?? 'You'} uri={avatar.data} size={36} ring />
      </Pressable>
    </View>
  );
}
