import { rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { prepareImage, uploadToBucket } from './media';

/** `route` is trimmed by the server: the first and last 200 m and anything inside your private areas are left out. */
export type ShareField = 'distance' | 'duration' | 'pace' | 'date' | 'land' | 'title' | 'route';

export interface NewPost {
  audience: 'only_me' | 'followers' | 'public' | 'club';
  body: string;
  clubId?: string | null;
  activityId?: string | null;
  shareFields?: ShareField[];
  routeCourseId?: string | null;
  commentsEnabled?: boolean;
  isAnnouncement?: boolean;
  photos?: { uri: string; alt: string }[];
}

/**
 * Publish a post. Activity fields are copied server-side from the runner's own record (never from
 * the client) and imported health data cannot be attached. Photos are re-encoded on the device,
 * uploaded to a private bucket, then metadata-stripped and published by a server job.
 */
export async function publishPost(p: NewPost, onProgress?: (msg: string) => void): Promise<{ postId: string; status: string }> {
  const photos = p.photos ?? [];
  const res = await rpc<{ post_id: string; upload_slots: { position: number; bucket: string; path: string }[]; status: string }>('create_post', {
    p_audience: p.audience,
    p_body: p.body.trim() || null,
    p_club: p.audience === 'club' ? p.clubId ?? null : null,
    p_activity: p.activityId ?? null,
    p_share_fields: p.shareFields ?? [],
    p_route_course: p.routeCourseId ?? null,
    p_comments_enabled: p.commentsEnabled ?? true,
    p_media_count: photos.length,
    p_is_announcement: p.isAnnouncement ?? false
  });
  for (const slot of res.upload_slots) {
    const photo = photos[slot.position]!;
    onProgress?.(`Uploading photo ${slot.position + 1} of ${photos.length}…`);
    const img = await prepareImage(photo.uri);
    await uploadToBucket('media-uploads', slot.path, img.uri);
  }
  if (photos.length) await rpc('finalize_post_media', { p_post: res.post_id, p_alt_texts: photos.map((x) => x.alt.trim()) });
  track('social_action', { action: 'post_created', audience_class: p.audience, outcome: 'ok' });
  if (/@[A-Za-z0-9_]{3,24}/.test(p.body)) track('social_action', { action: 'mention_sent', audience_class: p.audience, outcome: 'ok' });
  return { postId: res.post_id, status: res.status };
}
