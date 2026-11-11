import { useMemo } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc, friendlyError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtArea, fmtDistance, fmtDuration, fmtPace, fmtRelative, splitValue } from '@/lib/format';
import { Avatar, Badge, Card, IconButton, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useUnits } from '@/state/session';
import { radius, spacing, usePalette } from '@/theme/tokens';
import { useSignedUrl } from './media';
import { landLine, RouteSketch } from '@/features/share/RouteSketch';

export interface PostJson {
  id: string;
  audience: 'only_me' | 'followers' | 'public' | 'club';
  body: string | null;
  status: string;
  author: { id: string; handle: string; display_name: string; avatar_path: string | null };
  club: { id: string; name: string; kind: string } | null;
  shared_summary: {
    distance_m?: number;
    elapsed_ms?: number;
    avg_pace_s_per_km?: number;
    activity_date?: string;
    achievement?: 'land_claimed';
    area_m2?: number;
    achievement_title?: 'route_title';
  } | null;
  /** The run's route as others may see it (first and last 200 m and private areas left out by the server). */
  shared_route?: string[] | null;
  /** The run's published land on the all-time map (or its club race); gone if the result is ruled invalid. */
  shared_land?: SharedLand | null;
  route: { id: string; name: string } | null;
  comments_enabled: boolean;
  is_announcement: boolean;
  published_at: string;
  edited_at: string | null;
  reaction_count: number;
  i_reacted: boolean;
  comment_count: number;
  media: { id: string; path: string | null; alt: string | null; width: number | null; height: number | null; status: string }[];
  is_mine: boolean;
}

export interface SharedLand {
  layer: 'permanent' | 'public' | 'club' | 'event';
  area_m2: number;
  cell_count: number;
  cells: string[];
  taken: string[];
  gained_cells: number;
  kept_cells: number;
  taken_cells: number;
  rivals: number;
}

export const AUDIENCE_LABEL: Record<PostJson['audience'], string> = { only_me: 'Only me', followers: 'Followers', public: 'Public', club: 'Club members' };

type FeedFn = 'feed_following' | 'feed_discover' | 'club_feed' | 'profile_posts';

/** Cursor-paged feed: every item is authorized server-side for this viewer (FR34). */
export function useFeed(fn: FeedFn, args: Record<string, unknown>, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['feed', fn, args],
    enabled,
    initialPageParam: null as null | { before: string; beforeId: string },
    queryFn: async ({ pageParam }) => {
      const rows = await rpc<PostJson[]>(fn, { ...args, p_before: pageParam?.before ?? null, p_before_id: pageParam?.beforeId ?? null, p_limit: 20 });
      return rows ?? [];
    },
    getNextPageParam: (last) => (last.length < 20 ? undefined : { before: last[last.length - 1]!.published_at, beforeId: last[last.length - 1]!.id })
  });
}

function MediaImage({ m }: { m: PostJson['media'][number] }) {
  const p = usePalette();
  const url = useSignedUrl('post-media', m.status === 'ready' ? m.path : null);
  if (m.status !== 'ready') {
    return (
      <View style={{ height: 140, borderRadius: radius.md, backgroundColor: p.surfaceAlt, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
        <Icon name="image" color={p.textSubtle} size={26} />
        <Txt variant="caption">{m.status === 'rejected' ? 'Photo could not be processed' : 'Processing photo…'}</Txt>
      </View>
    );
  }
  const ratio = m.width && m.height ? m.width / m.height : 4 / 3;
  return (
    <Image
      source={url.data ? { uri: url.data } : undefined}
      style={{ width: '100%', aspectRatio: Math.max(0.6, Math.min(ratio, 2)), borderRadius: radius.md, backgroundColor: p.surfaceAlt }}
      contentFit="cover"
      accessibilityLabel={m.alt || 'Photo without a description'}
      accessible
    />
  );
}

export function SharedSummary({ s }: { s: NonNullable<PostJson['shared_summary']> }) {
  const p = usePalette();
  const units = useUnits();
  const dist = s.distance_m != null ? splitValue(fmtDistance(s.distance_m, units)) : null;
  const meta = [s.elapsed_ms != null ? fmtDuration(s.elapsed_ms) : null, s.avg_pace_s_per_km != null ? fmtPace(s.avg_pace_s_per_km, units) : null, s.activity_date ?? null].filter(Boolean);
  return (
    <View style={{ gap: spacing.sm }}>
      {dist || meta.length ? (
        <View style={{ borderRadius: radius.md, backgroundColor: p.blueSoft, padding: spacing.lg, gap: 2 }} accessible accessibilityLabel={[dist ? `${dist.value} ${dist.unit}` : null, ...meta].filter(Boolean).join(', ')}>
          {dist ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs }}>
              <Txt variant="metric" style={{ color: p.blueText }}>{dist.value}</Txt>
              <Txt variant="heading" style={{ color: p.blueText, marginBottom: 4 }}>{dist.unit}</Txt>
            </View>
          ) : null}
          {meta.length ? <Txt variant="label" color="textMuted">{meta.join('   ')}</Txt> : null}
        </View>
      ) : null}
      {s.achievement === 'land_claimed' || s.achievement_title === 'route_title' ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {s.achievement === 'land_claimed' ? <Badge tone="violet" icon="hexagon" label={`Claimed land${s.area_m2 ? ` · ${fmtArea(s.area_m2, units)}` : ''}`} /> : null}
          {s.achievement_title === 'route_title' ? <Badge tone="title" icon="trophy" label="Took a route title" /> : null}
        </View>
      ) : null}
    </View>
  );
}

function BodyText({ text }: { text: string }) {
  const p = usePalette();
  const parts = text.split(/(@[A-Za-z0-9_]{3,24}|loopfield:\/\/(?:post|route|club|profile)\/[0-9a-f-]{36})/g);
  return (
    <Txt>
      {parts.map((part, i) => {
        if (part.startsWith('@')) return <Txt key={i} style={{ color: p.primary, fontWeight: '600' }}>{part}</Txt>;
        const m = /^loopfield:\/\/(post|route|club|profile)\/([0-9a-f-]{36})$/.exec(part);
        if (m) {
          const [, kind, id] = m;
          const path = kind === 'post' ? '/post/[id]' : kind === 'route' ? '/routes/[id]' : kind === 'club' ? '/club/[id]' : '/profile/[id]';
          // Content links resolve through the normal authorization path on the destination screen.
          return (
            <Text key={i} style={{ color: p.info, textDecorationLine: 'underline' }} accessibilityRole="link" onPress={() => router.push({ pathname: path as never, params: { id: id! } })}>
              {`Open linked ${kind}`}
            </Text>
          );
        }
        return part;
      })}
    </Txt>
  );
}

export function usePostActions(post: PostJson) {
  const qc = useQueryClient();
  const react = useMutation({
    mutationFn: () => rpc<boolean>('toggle_reaction', { p_post: post.id }),
    onSuccess: (on) => {
      track('social_action', { action: on ? 'reaction_added' : 'reaction_removed', audience_class: post.audience, outcome: 'ok' });
      void qc.invalidateQueries({ queryKey: ['feed'] });
      void qc.invalidateQueries({ queryKey: ['post', post.id] });
    },
    onError: (e) => Alert.alert('Could not update', friendlyError(e))
  });
  const remove = async () => {
    try {
      await rpc('delete_post', { p_post: post.id });
      track('social_action', { action: 'post_deleted', audience_class: post.audience, outcome: 'ok' });
      void qc.invalidateQueries({ queryKey: ['feed'] });
      return true;
    } catch (e) {
      Alert.alert('Could not delete', friendlyError(e));
      return false;
    }
  };
  const menu = (onDeleted?: () => void) => {
    const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    if (post.is_mine) {
      buttons.push({ text: 'Edit', onPress: () => router.push({ pathname: '/compose', params: { edit: post.id } }) });
      buttons.push({ text: 'Delete', style: 'destructive', onPress: () => Alert.alert('Delete post?', 'This removes the post, its comments and photos.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void remove().then((ok) => ok && onDeleted?.()) }]) });
    } else {
      buttons.push({ text: 'Report post', onPress: () => router.push({ pathname: '/report', params: { type: 'post', id: post.id } }) });
      buttons.push({ text: `Mute @${post.author.handle}`, onPress: () => void rpc('mute_user', { p_target: post.author.id, p_muted: true }).then(() => { track('social_action', { action: 'muted', audience_class: 'none', outcome: 'ok' }); void qc.invalidateQueries({ queryKey: ['feed'] }); }) });
      buttons.push({ text: `Block @${post.author.handle}`, style: 'destructive', onPress: () => Alert.alert('Block this runner?', 'They will not be able to see your profile, posts or message you, and their content is hidden from you.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Block', style: 'destructive', onPress: () => void rpc('block_user', { p_target: post.author.id }).then(() => { track('social_action', { action: 'blocked', audience_class: 'none', outcome: 'ok' }); void qc.invalidateQueries(); }) }]) });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Post options', undefined, buttons);
  };
  return { react, menu, remove };
}

/** The run's route and land on a card; tapping opens the larger map (zoom, start and finish, cells). */
function RunMapPreview({ post }: { post: PostJson }) {
  const p = usePalette();
  const units = useUnits();
  const land = post.shared_land ?? null;
  const line = landLine(land);
  const input = useMemo(() => ({ route: post.shared_route ?? null, cells: land?.cells ?? null, taken: land?.taken ?? null }), [post.shared_route, land]);
  return (
    <Pressable onPress={() => router.push({ pathname: '/post/route/[id]', params: { id: post.id } })} accessibilityRole="button"
      accessibilityLabel={`Open the run's map${line ? `. ${line}` : ''}`} style={({ pressed }) => ({ gap: spacing.sm, opacity: pressed ? 0.85 : 1 })}>
      <RouteSketch input={input} height={168} />
      {line ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="hexagon" color={p.primary} size={18} />
          <Txt variant="label" style={{ flex: 1 }} numberOfLines={1}>{`${line}${land?.area_m2 ? ` · ${fmtArea(land.area_m2, units)}` : ''}`}</Txt>
          <Icon name="chevron-right" color={p.textSubtle} size={18} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function PostCard({ post, onOpen = true }: { post: PostJson; onOpen?: boolean }) {
  const p = usePalette();
  const avatar = useSignedUrl('avatars', post.author.avatar_path);
  const { react, menu } = usePostActions(post);
  return (
    <Card onPress={onOpen ? () => router.push({ pathname: '/post/[id]', params: { id: post.id } }) : undefined} accessibilityLabel={`Post by ${post.author.display_name}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: post.author.id } })} accessibilityRole="link" accessibilityLabel={`Open ${post.author.display_name}'s profile`}>
          <Avatar name={post.author.display_name} uri={avatar.data} size={42} />
        </Pressable>
        <View style={{ flex: 1, gap: 1 }}>
          <Txt variant="bodyStrong" numberOfLines={1}>{post.author.display_name}</Txt>
          <Txt variant="caption" numberOfLines={1}>
            {`@${post.author.handle} · ${fmtRelative(post.published_at)} · ${post.club ? post.club.name : AUDIENCE_LABEL[post.audience]}${post.edited_at ? ' · edited' : ''}`}
          </Txt>
        </View>
        <IconButton icon="more" label="Post options" onPress={() => menu()} color={p.textMuted} />
      </View>
      {post.is_announcement || post.status === 'processing' ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {post.is_announcement ? <Badge tone="info" icon="bell" label="Announcement" /> : null}
          {post.status === 'processing' ? <Badge tone="muted" label="Publishing after photos are processed" /> : null}
        </View>
      ) : null}
      {post.body ? <BodyText text={post.body} /> : null}
      {post.shared_summary ? <SharedSummary s={post.shared_summary} /> : null}
      {post.shared_route?.length || post.shared_land ? <RunMapPreview post={post} /> : null}
      {post.route ? (
        <Pressable onPress={() => router.push({ pathname: '/routes/[id]', params: { id: post.route!.id } })} accessibilityRole="link" accessibilityLabel={`Route: ${post.route.name}`} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
          <Icon name="route" color={p.orangeText} size={20} />
          <Txt variant="label" style={{ color: p.orangeText, flex: 1 }} numberOfLines={1}>{post.route.name}</Txt>
          <Icon name="chevron-right" color={p.textSubtle} size={18} />
        </Pressable>
      ) : null}
      {post.media.map((m) => <MediaImage key={m.id} m={m} />)}
      <View style={{ flexDirection: 'row', gap: spacing.xl, alignItems: 'center' }}>
        <Pressable
          onPress={() => react.mutate()}
          disabled={react.isPending}
          accessibilityRole="button"
          accessibilityState={{ selected: post.i_reacted }}
          accessibilityLabel={`${post.i_reacted ? 'Remove cheer' : 'Cheer'}. ${post.reaction_count} cheers`}
          hitSlop={6}
          style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, opacity: pressed ? 0.6 : 1 })}>
          <Icon name={post.i_reacted ? 'heart-filled' : 'heart'} color={post.i_reacted ? p.danger : p.textMuted} size={22} />
          <Txt variant="label" tabular style={{ color: post.i_reacted ? p.danger : p.textMuted }}>{String(post.reaction_count)}</Txt>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 }} accessible accessibilityLabel={`${post.comment_count} comments${post.comments_enabled ? '' : ', comments off'}`}>
          <Icon name="chat" color={p.textMuted} size={21} />
          <Txt variant="label" color="textMuted" tabular>{`${post.comment_count}${post.comments_enabled ? '' : ' · comments off'}`}</Txt>
        </View>
      </View>
    </Card>
  );
}
