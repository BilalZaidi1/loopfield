/** Error raised by an ops RPC, carrying the Postgres error code. */
export class OpsError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'OpsError';
    this.code = code;
  }
}

/** Turns database and network errors into the sentence an operator should read. */
export function friendlyError(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  const message = e?.message ?? '';
  if (/multi-factor/i.test(message)) return 'Verify with your authenticator app, then try again.';
  if (e?.code === '42501' || /requires .* role/i.test(message)) return 'Your staff role does not allow this action.';
  if (e?.code === 'P0429' || /rate limit/i.test(message)) return 'Too many attempts. Wait a moment and try again.';
  if (/fetch failed|network|ECONN|timed out/i.test(message)) return 'Could not reach the server. Check the connection and try again.';
  // Validation messages from ops_* functions are written for people (errcode 22023 and plain exceptions).
  if (message && message.length < 200 && !/syntax|column|relation|function .* does not exist/i.test(message)) {
    return message.charAt(0).toUpperCase() + message.slice(1);
  }
  return 'Something went wrong. Try again, and check Sentry if it keeps happening.';
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export async function runAction(fn: () => Promise<unknown>, success?: string): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true, message: success };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}
