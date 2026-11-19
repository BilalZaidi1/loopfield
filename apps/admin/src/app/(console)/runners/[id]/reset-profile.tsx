'use client';

import { useState } from 'react';
import type { ActionResult } from '@/lib/errors';
import { ActionButton } from '@/components/client';

const FIELDS = [
  { key: 'display_name', label: 'Display name (back to the handle)' },
  { key: 'bio', label: 'Bio' },
  { key: 'avatar', label: 'Profile photo and avatar' },
  { key: 'city', label: 'City' }
];

/** Clears profile fields that break the rules, for example an abusive name or photo. */
export function ResetProfile({ handle, action }: { handle: string; action: (fields: string[], reason: string) => Promise<ActionResult> }) {
  const [fields, setFields] = useState<string[]>(['display_name']);
  return (
    <ActionButton label="Reset profile fields" variant="secondary" size="sm" title={`Reset fields on @${handle}`} disabled={false}
      description={
        <span className="flex flex-col gap-2 mt-1">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-2 type-body">
              <input type="checkbox" className="h-5 w-5 accent-[var(--lf-primary-fill)]" checked={fields.includes(f.key)}
                onChange={() => setFields((c) => (c.includes(f.key) ? c.filter((x) => x !== f.key) : [...c, f.key]))} />
              {f.label}
            </label>
          ))}
        </span>
      }
      action={(reason) => (fields.length ? action(fields, reason) : Promise.resolve({ ok: false, error: 'Choose at least one field.' } as ActionResult))} />
  );
}
