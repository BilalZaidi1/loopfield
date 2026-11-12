'use client';

import { useState } from 'react';
import type { RoleDef } from '@/lib/types';
import { ActionButton } from '@/components/client';
import { setStaffRole } from './actions';

export function GrantRole({ userId, handle, existing, roles }: { userId: string; handle: string; existing: string[]; roles: RoleDef[] }) {
  const options = roles.filter((r) => !existing.includes(r.key));
  const [key, setKey] = useState<string>(options.find((r) => r.key !== 'admin')?.key ?? options[0]?.key ?? '');
  const role = options.find((r) => r.key === key);
  if (!options.length || !role) return <span className="type-caption text-muted">Has every role</span>;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select aria-label={`Role for @${handle}`} value={key} onChange={(e) => setKey(e.target.value)}
        className="border border-line-strong focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary rounded-md px-2 min-h-9 type-label bg-surface text-ink">
        {options.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
      </select>
      <ActionButton
        label="Grant"
        size="sm"
        variant="primary"
        requireReason={false}
        confirmPhrase={key === 'admin' ? `@${handle}` : undefined}
        title={`Grant ${role.label} to @${handle}?`}
        description={<>{role.description || `${role.permissions.length} permissions.`} They will need to set up an authenticator app before using the console.</>}
        action={() => setStaffRole(userId, key, true)}
      />
    </div>
  );
}
