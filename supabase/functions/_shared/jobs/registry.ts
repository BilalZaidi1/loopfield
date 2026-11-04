import { scrubText } from '../core/index.ts';
import type { Sql } from '../clients.ts';
import { deleteAccount, deleteActivity, exportData, purgeRawEvidence, withdrawCompetition } from './account.ts';
import { reconcileEntitlement } from './billing.ts';
import { buildRouteProposal, evaluateAttemptJob, evaluateFoundingAttempt, evaluateLoopJob, reconcileActivity } from './competition.ts';
import { NonRetryableError, type JobContext, type JobHandler, type JobRow } from './context.ts';
import {
  clubInvitationEmailJob,
  deactivateChatUser,
  deletePostMedia,
  dispatchDigests,
  moderateMessage,
  processPostMedia,
  pushPending,
  syncBlock
} from './social.ts';

export const HANDLERS: Record<string, JobHandler> = {
  reconcile_activity: reconcileActivity,
  evaluate_loop: evaluateLoopJob,
  evaluate_attempt: evaluateAttemptJob,
  build_route_proposal: buildRouteProposal,
  evaluate_founding_attempt: evaluateFoundingAttempt,
  process_post_media: processPostMedia,
  delete_post_media: deletePostMedia,
  push_pending: pushPending,
  dispatch_digests: dispatchDigests,
  club_invitation: clubInvitationEmailJob,
  sync_block: syncBlock,
  deactivate_user: deactivateChatUser,
  moderate_message: moderateMessage,
  delete_activity: deleteActivity,
  withdraw_competition: withdrawCompetition,
  export_data: exportData,
  delete_account: deleteAccount,
  purge_raw_evidence: purgeRawEvidence,
  reconcile_entitlement: reconcileEntitlement
};

export const ALL_QUEUES = ['territory', 'speed', 'publication', 'social', 'notifications', 'media', 'email', 'chat', 'account', 'billing', 'maintenance'];

export interface BatchResult {
  claimed: number;
  succeeded: number;
  failed: number;
}

/**
 * Claim and run one batch. Each job is committed independently; a failure is retried with backoff
 * (or dead-lettered) without affecting other jobs or queues.
 */
export async function runBatch(
  ctx: JobContext,
  workerId: string,
  queues: string[] = ALL_QUEUES,
  limit = 10,
  report: (err: unknown, job: JobRow) => void = () => {}
): Promise<BatchResult> {
  const sql: Sql = ctx.sql;
  const jobs = (await sql`select * from internal.claim_jobs(${workerId}, ${sql.array(queues)}::text[], ${limit}, 300)`) as unknown as JobRow[];
  const result: BatchResult = { claimed: jobs.length, succeeded: 0, failed: 0 };
  for (const job of jobs) {
    const handler = HANDLERS[job.kind];
    try {
      if (!handler) throw new NonRetryableError(`no handler for ${job.kind}`);
      await handler(job.payload ?? {}, ctx, job);
      await sql`select internal.complete_job(${job.id}, ${workerId})`;
      result.succeeded++;
    } catch (err) {
      result.failed++;
      const message = scrubText(String((err as Error)?.message ?? err)).slice(0, 1500);
      await sql`select internal.fail_job(${job.id}, ${workerId}, ${message}, ${!(err instanceof NonRetryableError)})`;
      ctx.log('job failed', { kind: job.kind, attempts: job.attempts, error: message });
      report(err, job);
    }
  }
  return result;
}
