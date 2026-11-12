'use client';

import { useState } from 'react';
import { ROLES, ROLE_HELP, ROLE_LABEL, type Role } from '@/lib/roles';
import { ActionButton } from '@/components/client';
import { setStaffRole } from './actions';

export function GrantRole({ userId, handle, existing }: { userId: string; handle: string; existing: string[] }) {
  const options = ROLES.filter((r) => !existing.includes(r));
  const [role, setRole] = useState<Role>(options.find((r) => r !== 'admin') ?? options[0] ?? 'support');
  if (!options.length) return <span className="type-caption text-muted">Has every role</span>;
  return (
    <div className="flex items-center gap-2">
      <select aria-label={`Role for @${handle}`} value={role} onChange={(e) => setRole(e.target.value as Role)}
        className="border border-line-strong focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary rounded-md px-2 min-h-9 type-label bg-surface text-ink">
        {options.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </select>
      <ActionButton
        label="Grant"
        size="sm"
        variant="primary"
        requireReason={false}
        confirmPhrase={role === 'admin' ? `@${handle}` : undefined}
        title={`Grant ${ROLE_LABEL[role]} to @${handle}?`}
        description={<>{ROLE_HELP[role]} They will need to set up an authenticator app before using the console.</>}
        action={() => setStaffRole(userId, role, true)}
      />
    </div>
  );
}
