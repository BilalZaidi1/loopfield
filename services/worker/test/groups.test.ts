import { afterAll, describe, expect, it } from 'vitest';
import { openGroupChat, reportMessage, type ChatServer } from '../../../supabase/functions/_shared/api/chat.ts';
import { BUCKETS } from '../../../supabase/functions/_shared/blobs.ts';
import { createUser, drain, makeCtx } from './helpers.ts';

const ctx = makeCtx(4);
afterAll(async () => {
  await (ctx.sql as unknown as { end(): Promise<void> }).end();
});

async function makeGroup(owner: string, name: string): Promise<string> {
  const [g] = await ctx.sql`insert into public.clubs (kind, name, visibility, join_policy, created_by) values ('group', ${name}, 'private', 'invite_only', ${owner}) returning id`;
  await ctx.sql`insert into public.club_memberships (club_id, user_id, role, state) values (${g!.id}, ${owner}, 'owner', 'active')`;
  return g!.id as string;
}

describe('groups: chat follows membership, closing cleans up', () => {
  it('keeps the group chat members exactly the group members', async () => {
    const owner = await createUser(ctx.sql, 'grp_owner');
    const friend = await createUser(ctx.sql, 'grp_friend');
    const id = await makeGroup(owner, 'Tuesday Crew');
    await ctx.sql`insert into public.club_memberships (club_id, user_id, role, state) values (${id}, ${friend}, 'member', 'active')`;
    await ctx.sql`update internal.jobs set run_at = now() where kind = 'sync_group_chat' and payload ->> 'club_id' = ${id}`;
    await drain(ctx, 'groups-worker', 50, ['chat', 'account']);
    expect(ctx.integrations.calls.groups.get(`grp-${id}`)).toEqual({ name: 'Tuesday Crew', members: [owner, friend] });

    await ctx.sql`update public.club_memberships set state = 'removed' where club_id = ${id} and user_id = ${friend}`;
    await ctx.sql`update internal.jobs set run_at = now() where kind = 'sync_group_chat' and payload ->> 'club_id' = ${id}`;
    await drain(ctx, 'groups-worker', 50, ['chat', 'account']);
    expect(ctx.integrations.calls.groups.get(`grp-${id}`)?.members).toEqual([owner]);
  });

  it("deletes a closed group's chat and images", async () => {
    const owner = await createUser(ctx.sql, 'grp_closer');
    const id = await makeGroup(owner, 'Short Lived');
    await ctx.blobs.put(BUCKETS.clubMedia, `${id}/logo-1.jpg`, 'x', 'image/jpeg');
    await ctx.sql`select internal.archive_club(${id}::uuid, ${owner}::uuid, 'test')`;
    await ctx.sql`update internal.jobs set run_at = now() where kind in ('sync_group_chat', 'close_club')`;
    await drain(ctx, 'groups-worker', 50, ['chat', 'account']);
    expect(ctx.integrations.calls.deletedGroups).toContain(`grp-${id}`);
    expect(await ctx.blobs.list(BUCKETS.clubMedia, `${id}/`)).toEqual([]);
  });

  it("opens the chat only for members, and members can report each other's messages", async () => {
    const owner = await createUser(ctx.sql, 'grp_chat_owner');
    const member = await createUser(ctx.sql, 'grp_chat_member');
    const outsider = await createUser(ctx.sql, 'grp_chat_out');
    const id = await makeGroup(owner, 'Hill Repeats');
    await ctx.sql`insert into public.club_memberships (club_id, user_id, role, state) values (${id}, ${member}, 'member', 'active')`;
    const synced: string[][] = [];
    const chat: ChatServer = {
      apiKey: 'k',
      async upsertUser() {},
      createToken: (u, ttl) => ({ token: u, expiresAt: ttl }),
      async createChannel() {},
      async getMessage(mid) {
        return { id: mid, text: 'hello', user_id: owner, channel_id: `grp-${id}`, created_at: new Date().toISOString() };
      },
      async getContext() {
        return [];
      },
      async syncGroup(_c, _n, members) {
        synced.push(members.map((m) => m.id));
      }
    };
    await expect(openGroupChat(ctx.sql, chat, outsider, id)).rejects.toMatchObject({ status: 403 });
    expect(await openGroupChat(ctx.sql, chat, member, id)).toEqual({ channelId: `grp-${id}`, name: 'Hill Repeats' });
    expect(synced[0]).toEqual([owner, member]);
    await expect(reportMessage(ctx.sql, chat, outsider, { channelId: `grp-${id}`, messageId: 'm1', category: 'harassment' })).rejects.toMatchObject({ status: 403 });
    await expect(reportMessage(ctx.sql, chat, owner, { channelId: `grp-${id}`, messageId: 'm1', category: 'harassment' })).rejects.toMatchObject({ status: 400 });
    const r = await reportMessage(ctx.sql, chat, member, { channelId: `grp-${id}`, messageId: 'm1', category: 'harassment' });
    expect(r.reportId).toBeTruthy();
  });
});
