import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SOCIAL_RULES } from '@loopfield/core';
import { friendlyError, rpc } from '@/lib/api';
import { Banner, Button, Card, EmptyState, LoadingState, Screen, Segmented, TextField, Toggle, Txt } from '@/components/ui';
import { useMyClubs } from '@/features/clubs/api';
import { AUDIENCE_LABEL, type PostJson } from '@/features/social/PostCard';
import { publishPost } from '@/features/social/publish';
import { useSession } from '@/state/session';
import { radius, spacing } from '@/theme/tokens';

type Audience = 'only_me' | 'followers' | 'public' | 'club';

const AUDIENCE_HELP: Record<Audience, string> = {
  only_me: 'Only you can see this post.',
  followers: 'Your approved followers can see this post.',
  public: 'Anyone signed in can see this post.',
  club: 'Active members of the selected group can see this post.'
};

/** S08 Post composer — text, bounded photos with alt text, route attachment, audience preview and publish. */
export default function Compose() {
  const params = useLocalSearchParams<{ edit?: string; club?: string; route?: string }>();
  const editing = useQuery({ queryKey: ['post', params.edit], enabled: Boolean(params.edit), queryFn: () => rpc<PostJson | null>('post_detail', { p_post: params.edit }) });
  if (params.edit && editing.isLoading) return <LoadingState />;
  if (params.edit && !editing.data) return <Screen><EmptyState title="This post can no longer be edited" /></Screen>;
  return <ComposeForm key={params.edit ?? 'new'} params={params} editing={editing.data ?? null} />;
}

function ComposeForm({ params, editing }: { params: { edit?: string; club?: string; route?: string }; editing: PostJson | null }) {
  const qc = useQueryClient();
  const { settings } = useSession();
  const clubs = useMyClubs();
  const [audience, setAudience] = useState<Audience>(editing?.audience ?? (params.club ? 'club' : settings?.default_post_audience ?? 'followers'));
  const [clubId, setClubId] = useState<string | null>(params.club ?? null);
  const [body, setBody] = useState(editing?.body ?? '');
  const [photos, setPhotos] = useState<{ uri: string; alt: string }[]>([]);
  const [comments, setComments] = useState(editing?.comments_enabled ?? true);
  const [announce, setAnnounce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const route = useQuery({ queryKey: ['route-name', params.route], enabled: Boolean(params.route), queryFn: async () => (await rpc<{ name: string } | null>('resolve_content_link', { p_kind: 'route', p_id: params.route })) });

  const activeClubs = (clubs.data ?? []).filter((c) => c.state === 'active');
  const selectedClub = activeClubs.find((c) => c.id === clubId);
  const organizer = selectedClub && selectedClub.role !== 'member';

  const addPhotos = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: SOCIAL_RULES.maxPhotosPerPost.value - photos.length, quality: 0.9, exif: false });
    if (res.canceled) return;
    setPhotos((cur) => [...cur, ...res.assets.map((a) => ({ uri: a.uri, alt: '' }))].slice(0, SOCIAL_RULES.maxPhotosPerPost.value));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (params.edit) {
        await rpc('update_post', { p_post: params.edit, p_body: body, p_audience: audience === 'club' ? null : audience, p_comments_enabled: comments });
      } else {
        await publishPost({ audience, body, clubId, routeCourseId: params.route ?? null, commentsEnabled: comments, isAnnouncement: announce, photos }, setProgress);
      }
      void qc.invalidateQueries({ queryKey: ['feed'] });
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const empty = !body.trim() && !photos.length && !params.route;
  return (
    <Screen>
      <View style={{ gap: spacing.md }}>
        <TextField label="Post" value={body} onChangeText={setBody} multiline maxLength={SOCIAL_RULES.maxPostBodyChars.value} placeholder="Share a run, a route or an update. Use @handle to mention someone." />
        {route.data ? <Card><Txt variant="label">Attached route: {route.data.name}</Txt></Card> : null}
        {!params.edit ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {photos.map((ph, i) => (
                <View key={ph.uri} style={{ width: '47%', gap: spacing.xs }}>
                  <Image source={{ uri: ph.uri }} style={{ width: '100%', aspectRatio: 1, borderRadius: radius.md }} accessibilityLabel={ph.alt || `Selected photo ${i + 1}`} />
                  <TextField label={`Description for photo ${i + 1}`} value={ph.alt} onChangeText={(t) => setPhotos((cur) => cur.map((x, j) => (j === i ? { ...x, alt: t } : x)))} maxLength={500} hint="Helps people using screen readers." />
                  <Pressable onPress={() => setPhotos((cur) => cur.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`}>
                    <Txt variant="caption" color="danger">Remove</Txt>
                  </Pressable>
                </View>
              ))}
            </View>
            {photos.length < SOCIAL_RULES.maxPhotosPerPost.value ? <Button variant="secondary" label={`Add photos (${photos.length}/${SOCIAL_RULES.maxPhotosPerPost.value})`} onPress={() => void addPhotos()} /> : null}
            <Txt variant="caption">Location and other metadata are removed from photos before anyone sees them.</Txt>
            <Txt variant="caption">To share a run, open it from Activity history and choose Share.</Txt>
          </>
        ) : null}
        <Segmented
          label="Audience"
          value={audience}
          onChange={setAudience}
          options={[{ value: 'only_me', label: 'Only me' }, { value: 'followers', label: 'Followers' }, { value: 'public', label: 'Public' }, ...(activeClubs.length && !params.edit ? [{ value: 'club' as const, label: 'Group' }] : [])]}
        />
        {audience === 'club' ? (
          activeClubs.length ? <Segmented label="Group" value={clubId ?? ''} onChange={setClubId} options={activeClubs.map((c) => ({ value: c.id, label: c.name }))} /> : <Txt color="textMuted">Join a group to post to it.</Txt>
        ) : null}
        <Card accessibilityLabel="Audience preview">
          <Txt variant="label">Who can see this: {audience === 'club' && selectedClub ? selectedClub.name : AUDIENCE_LABEL[audience]}</Txt>
          <Txt variant="caption">{AUDIENCE_HELP[audience]} Mentions never widen the audience.</Txt>
        </Card>
        <Toggle label="Allow comments" value={comments} onChange={setComments} />
        {audience === 'club' && organizer && !params.edit ? <Toggle label="Post as an announcement" value={announce} onChange={setAnnounce} /> : null}
        {progress ? <Banner text={progress} /> : null}
        {error ? <Banner tone="danger" text={error} /> : null}
        <Button label={params.edit ? 'Save changes' : 'Publish'} onPress={() => void submit()} loading={busy} disabled={busy || empty || (audience === 'club' && !clubId)} />
        <Button variant="ghost" label="Cancel" onPress={() => (body || photos.length ? Alert.alert('Discard this post?', undefined, [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => router.back() }]) : router.back())} />
      </View>
    </Screen>
  );
}
