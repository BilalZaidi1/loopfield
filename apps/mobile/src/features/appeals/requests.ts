/** A runner's request for a review of a decision (the appeals table, which only they and reviewers read). */
export interface Appeal {
  id: string;
  object_type: string;
  object_id: string;
  reason: string;
  status: 'submitted' | 'in_review' | 'upheld' | 'overturned' | 'withdrawn';
  response: string | null;
  created_at: string;
  decided_at: string | null;
}

/**
 * The request already made for this decision, if any. A suspension is asked about once while it lasts:
 * the server stores its own id for each suspension, so a request counts when it was made after the
 * suspension started.
 */
export function existingRequest(list: readonly Appeal[], type: string | undefined, id: string | undefined, suspendedSince: string | null | undefined): Appeal | undefined {
  if (type === 'account_action') {
    return list.find((a) => a.object_type === 'account_action' && (suspendedSince ? a.created_at >= suspendedSince : a.status === 'submitted' || a.status === 'in_review'));
  }
  return list.find((a) => a.object_id === id && a.object_type === type);
}
