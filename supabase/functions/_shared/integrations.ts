import { serviceClient } from './clients.ts';
import { sendEmail } from './email.ts';
import type { ServerEnv } from './env.ts';
import type { Integrations } from './jobs/context.ts';
import { revenueCatRestClient } from './jobs/billing.ts';
import { sendExpoPush } from './push.ts';
import { DM_CHANNEL_TYPE, streamServer } from './stream.ts';

/** Real provider integrations, each enabled only when its server-side credentials are configured. */
export function buildIntegrations(env: ServerEnv): Integrations {
  const admin = serviceClient(env);
  const chatConfigured = Boolean(env.STREAM_API_KEY && env.STREAM_API_SECRET);
  return {
    sendPush: (messages) => sendExpoPush(env, messages),
    sendEmail: (msg) => sendEmail(env, msg),
    chat: chatConfigured
      ? {
          async setFrozen(channelId, frozen) {
            await streamServer(env).channel(DM_CHANNEL_TYPE, channelId).updatePartial({ set: { frozen } } as never);
          },
          async deactivateUser(userId) {
            await streamServer(env).deactivateUser(userId, { mark_messages_deleted: false } as never);
          },
          async deleteUser(userId) {
            await streamServer(env).deleteUsers([userId], { user: 'hard', messages: 'hard', conversations: 'hard' });
          },
          async deleteMessage(messageId) {
            await streamServer(env).deleteMessage(messageId, true);
          }
        }
      : null,
    revenuecat: env.REVENUECAT_SECRET_API_KEY ? revenueCatRestClient(env.REVENUECAT_SECRET_API_KEY) : null,
    auth: {
      async deleteUser(userId) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error && !/not found/i.test(error.message)) throw new Error(`auth delete failed: ${error.message}`);
      },
      async getEmail(userId) {
        const { data } = await admin.auth.admin.getUserById(userId);
        return data?.user?.email ?? null;
      }
    }
  };
}
