import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useIsFocused } from 'expo-router';
import { track } from '@/lib/analytics';
import { useNow } from '@/lib/useNow';
import { Avatar, Button, ListGroup, Row, Sheet, Txt } from '@/components/ui';
import { useSignedUrls } from '@/features/social/media';
import type { FriendMarkerData } from '@/features/map/FriendMarker';
import { spacing, useTheme } from '@/theme/tokens';
import { avatarName, friendName, friendStatus, handleLine, useFriendsLive, type FriendLive } from './api';

/**
 * Friends running now on the Map tab (R2): their picture markers and recent paths, "2 friends running" at the
 * top of the map, a list of them, and each friend's card (how long they have been running, the last update,
 * their profile). A friend inside one of their protected areas has no marker; the list says so instead.
 */
export function useFriendsOnMap(mapAvailable: boolean) {
  const focused = useIsFocused();
  const q = useFriendsLive(focused);
  const list = useMemo(() => q.data ?? [], [q.data]);
  const pictures = useSignedUrls('avatars', list.map((f) => f.avatar_path));
  const [openId, setOpenId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const urls = pictures.data;
  const markers = useMemo<FriendMarkerData[]>(
    () => (mapAvailable ? list.filter((f) => f.position).map((f) => ({
      id: f.user_id,
      coord: [f.position!.lng, f.position!.lat] as [number, number],
      name: friendName(f),
      uri: f.avatar_path ? urls?.[f.avatar_path] ?? null : null,
      bearing: f.bearing,
      paused: f.state === 'paused'
    })) : []),
    [mapAvailable, list, urls]
  );
  const trails = useMemo(() => (mapAvailable ? list.flatMap((f) => f.trail ?? []) : []), [mapAvailable, list]);
  return {
    list,
    markers,
    trails,
    pictureOf: (f: FriendLive) => (f.avatar_path ? urls?.[f.avatar_path] ?? null : null),
    openId,
    open: (id: string) => {
      setListOpen(false);
      setOpenId(id);
      track('friends_live', { action: 'friend_opened' });
    },
    close: () => setOpenId(null),
    listOpen,
    setListOpen
  };
}

export type FriendsOnMap = ReturnType<typeof useFriendsOnMap>;

export function FriendsRunningChip({ friends }: { friends: FriendsOnMap }) {
  const t = useTheme();
  const p = t.palette;
  const n = friends.list.length;
  if (!n) return null;
  const label = `${n} ${n === 1 ? 'friend' : 'friends'} running`;
  return (
    <Pressable onPress={() => friends.setListOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}. Show who`}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, backgroundColor: p.surface, opacity: pressed ? 0.85 : 1 }, t.elevation.floating]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.primary }} accessibilityElementsHidden />
      <Txt variant="label">{label}</Txt>
    </Pressable>
  );
}

export function FriendCard({ friends, onShowOnMap }: { friends: FriendsOnMap; onShowOnMap: (coord: [number, number]) => void }) {
  const now = useNow(10_000);
  const f = friends.openId ? friends.list.find((x) => x.user_id === friends.openId) ?? null : null;
  return (
    <>
      <Sheet visible={friends.listOpen} title="Friends running" onClose={() => friends.setListOpen(false)}>
        <ListGroup>
          {friends.list.map((x) => (
            <Row key={x.user_id} leading={<Avatar uri={friends.pictureOf(x)} name={avatarName(x)} size={40} />} title={friendName(x)} subtitle={friendStatus(x, now)} onPress={() => friends.open(x.user_id)} />
          ))}
        </ListGroup>
        <Txt variant="caption">Only friends who share their live runs with you appear here. Your own position is shared only if you turn that on in Privacy settings.</Txt>
      </Sheet>
      <Sheet visible={Boolean(f)} title={f ? friendName(f) : 'Friend'} onClose={friends.close}>
        {f ? (
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar uri={friends.pictureOf(f)} name={avatarName(f)} size={56} />
              <View style={{ flex: 1 }}>
                <Txt variant="heading">{friendName(f)}</Txt>
                {handleLine(f) ? <Txt variant="caption">{handleLine(f)}</Txt> : null}
              </View>
            </View>
            <View accessibilityLiveRegion="polite"><Txt>{friendStatus(f, now)}</Txt></View>
            {f.position ? <Button variant="secondary" icon="locate" label="Show on the map" onPress={() => { friends.close(); onShowOnMap([f.position!.lng, f.position!.lat]); }} /> : null}
            <Button variant="ghost" icon="user" label="View profile" onPress={() => { friends.close(); router.push({ pathname: '/profile/[id]', params: { id: f.user_id } }); }} />
          </View>
        ) : null}
      </Sheet>
    </>
  );
}
