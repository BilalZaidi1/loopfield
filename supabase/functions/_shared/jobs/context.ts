import type { BlobStore } from '../blobs.ts';
import type { Sql } from '../clients.ts';
import type { ServerEnv } from '../env.ts';
import type { PushMessage, PushResult } from '../push.ts';
import type { EmailMessage } from '../email.ts';

/** Side-effecting integrations are injected so handlers can be tested without live services. */
export interface Integrations {
  sendPush(messages: PushMessage[]): Promise<PushResult[]>;
  sendEmail(msg: EmailMessage): Promise<{ id: string }>;
  chat: {
    setFrozen(channelId: string, frozen: boolean): Promise<void>;
    deactivateUser(userId: string): Promise<void>;
    deleteUser(userId: string): Promise<void>;
    deleteMessage(messageId: string): Promise<void>;
    /** Creates the group's channel if needed and makes its members exactly `members` (backend-managed). */
    syncGroup(channelId: string, name: string, members: { id: string; name: string }[]): Promise<void>;
    deleteGroup(channelId: string): Promise<void>;
  } | null;
  revenuecat: { getSubscriber(appUserId: string): Promise<unknown>; deleteSubscriber(appUserId: string): Promise<void> } | null;
  auth: { deleteUser(userId: string): Promise<void>; getEmail(userId: string): Promise<string | null> };
}

export interface JobRow {
  id: number;
  queue: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface JobContext {
  sql: Sql;
  blobs: BlobStore;
  env: ServerEnv;
  integrations: Integrations;
  log(message: string, data?: Record<string, unknown>): void;
}

/** Errors that must not be retried (bad payloads, permanently invalid input). */
export class NonRetryableError extends Error {}

export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext, job: JobRow) => Promise<void>;
