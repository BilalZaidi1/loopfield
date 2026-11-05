import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SOCIAL_RULES } from '@loopfield/core';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtRelative } from '@/lib/format';
import { Avatar, Button, EmptyState, ErrorState, IconButton, ListGroup, LoadingState, Row, Screen, Section, TextField, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';
import { PostCard, type PostJson } from '@/features/social/PostCard';

interface Comment {
  id: string;
  author_id: string;
  handle: string;
  display_name: string;
  body: string;
  created_at: string;
  is_mine: boolean;
  can_delete: boolean;
}

/** S09 Post detail and comments — post, reactions, comments, mentions, audience, report and author controls. */
export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const post = useQuery({ queryKey: ['post', id], queryFn: () => rpc<PostJson | null>('post_detail', { p_post: id }) });
  const comments = useQuery({ queryKey: ['comments', id], enabled: Boolean(post.data), queryFn: () => rpc<Comment[]>('post_comments', { p_post: id, p_limit: 100 }) });
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => rpc<string>('add_comment', { p_post: id, p_body: text.trim() }),
    onSuccess: () => {
      track('social_action', { action: 'comment_created', audience_class: post.data?.audience ?? 'none', outcome: 'ok' });
      setText('');
      void qc.invalidateQueries({ queryKey: ['comments', id] });
      void qc.invalidateQueries({ queryKey: ['post', id] });
    },
    onError: (e) => Alert.alert('Comment not posted', friendlyError(e))
  });
  const del = useMutation({ mutationFn: (cid: string) => rpc('delete_comment', { p_comment: cid }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['comments', id] }) });

  if (post.isLoading) return <Screen><Stack.Screen options={{ title: 'Post' }} /><LoadingState variant="cards" /></Screen>;
  if (post.error) return <Screen><Stack.Screen options={{ title: 'Post' }} /><ErrorState error={post.error} onRetry={() => void post.refetch()} /></Screen>;
  if (!post.data) return <Screen><Stack.Screen options={{ title: 'Post' }} /><EmptyState icon="chat" title="This post is not available" body="It may have been removed, or its audience no longer includes you." /></Screen>;
  const p = post.data;
  return (
    <Screen
      footer={
        p.comments_enabled ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <TextField label="Add a comment" labelHidden compact placeholder="Add a comment" value={text} onChangeText={setText} multiline maxLength={SOCIAL_RULES.maxCommentChars.value} />
            </View>
            <IconButton icon="send" label="Post comment" variant="soft" onPress={() => add.mutate()} disabled={!text.trim() || add.isPending} />
          </View>
        ) : undefined
      }>
      <Stack.Screen options={{ title: 'Post' }} />
      <PostCard post={p} onOpen={false} />
      {p.status === 'removed' && p.is_mine ? <Button variant="secondary" label="Request a review of the removal" onPress={() => router.push({ pathname: '/appeals', params: { type: 'post', id: p.id } })} /> : null}
      <Section title={`Comments (${comments.data?.length ?? p.comment_count})`} icon="chat">
        {comments.isLoading ? <LoadingState /> : comments.data?.length ? (
          <ListGroup>
          {comments.data.map((c) => (
            <Row
              key={c.id}
              leading={<Avatar name={c.display_name} size={36} />}
              title={`${c.display_name} · ${fmtRelative(c.created_at)}`}
              subtitle={c.body}
              onPress={() =>
                Alert.alert('Comment', undefined, [
                  { text: 'View profile', onPress: () => router.push({ pathname: '/profile/[id]', params: { id: c.author_id } }) },
                  ...(c.can_delete ? [{ text: 'Delete comment', style: 'destructive' as const, onPress: () => del.mutate(c.id) }] : []),
                  ...(!c.is_mine ? [{ text: 'Report comment', onPress: () => router.push({ pathname: '/report', params: { type: 'comment', id: c.id } }) }] : []),
                  { text: 'Cancel', style: 'cancel' as const }
                ])
              }
            />
          ))}
          </ListGroup>
        ) : <Txt color="textMuted">No comments yet. Start the conversation.</Txt>}
      </Section>
      {p.comments_enabled ? null : <Txt color="textMuted">Comments are turned off for this post.</Txt>}
    </Screen>
  );
}
