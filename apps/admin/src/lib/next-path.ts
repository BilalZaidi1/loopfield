/** Only same-origin relative paths are allowed as post-sign-in destinations. */
export function safeNext(next: unknown): string | null {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (next.startsWith('/sign-in') || next.startsWith('/mfa')) return null;
  return next;
}
