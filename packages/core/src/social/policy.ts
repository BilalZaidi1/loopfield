/**
 * Social policy helpers mirrored from the database (the SQL functions are authoritative).
 * Used for UI state (what to offer) and unit tests of the policy matrix.
 */

export type Audience = 'only_me' | 'followers' | 'public' | 'club';
export type MessagesFrom = 'mutual' | 'followers' | 'nobody';

export interface Relationship {
  viewerFollowsAuthor: boolean; // accepted follow
  authorFollowsViewer: boolean;
  blockedEitherWay: boolean;
  viewerIsClubMember: boolean;
}

export function canViewPost(p: { audience: Audience; authorId: string; status: string }, viewerId: string, rel: Relationship): boolean {
  if (p.status !== 'published' && p.authorId !== viewerId) return false;
  if (p.authorId === viewerId) return true;
  if (rel.blockedEitherWay) return false;
  switch (p.audience) {
    case 'only_me':
      return false;
    case 'followers':
      return rel.viewerFollowsAuthor;
    case 'public':
      return true;
    case 'club':
      return rel.viewerIsClubMember;
  }
}

/** PRD §8/§9: new conversations require the recipient's allowed relationship; default mutual follow. */
export function canStartConversation(
  recipientSetting: MessagesFrom,
  rel: { senderFollowsRecipient: boolean; recipientFollowsSender: boolean; blockedEitherWay: boolean; senderIsRecipient: boolean }
): { allowed: boolean; reason: 'ok' | 'blocked' | 'not_allowed' | 'self' } {
  if (rel.senderIsRecipient) return { allowed: false, reason: 'self' };
  if (rel.blockedEitherWay) return { allowed: false, reason: 'blocked' };
  switch (recipientSetting) {
    case 'nobody':
      return { allowed: false, reason: 'not_allowed' };
    case 'followers':
      // "followers" means people the recipient has approved as followers (sender follows recipient, accepted).
      return rel.senderFollowsRecipient ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'not_allowed' };
    case 'mutual':
    default:
      return rel.senderFollowsRecipient && rel.recipientFollowsSender ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'not_allowed' };
  }
}

const HANDLE = /(^|[^A-Za-z0-9_])@([a-z0-9_]{3,24})\b/gi;

export function extractMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(HANDLE)) out.add(m[2]!.toLowerCase());
  return [...out].slice(0, 10);
}

export const CONTENT_LINK = /\bloopfield:\/\/(post|route|club|profile)\/([0-9a-f-]{36})\b/gi;

/** Internal content links carry identifiers only; the viewer's permissions are checked on open. */
export function extractContentLinks(text: string): Array<{ kind: 'post' | 'route' | 'club' | 'profile'; id: string }> {
  const out: Array<{ kind: 'post' | 'route' | 'club' | 'profile'; id: string }> = [];
  for (const m of text.matchAll(CONTENT_LINK)) out.push({ kind: m[1]!.toLowerCase() as 'post', id: m[2]!.toLowerCase() });
  return out;
}

export function dmChannelId(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  // Stream channel ids allow [a-z0-9_-] up to 64 chars; uuids without dashes keep it deterministic.
  return `dm_${x!.replace(/-/g, '').slice(0, 26)}_${y!.replace(/-/g, '').slice(0, 26)}`;
}
