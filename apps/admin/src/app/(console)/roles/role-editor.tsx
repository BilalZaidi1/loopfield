'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PermissionDef, RoleDef } from '@/lib/types';
import type { ActionResult } from '@/lib/errors';
import { Button, cx, inputClass } from '@/components/ui';
import { Modal, toast } from '@/components/client';
import { Icon } from '@/components/icons';
import type { RoleInput } from './actions';

/** Create a custom role or change what a role may do. Admins only; the database checks again. */
export function RoleEditor({ role, permissions, save, label = role ? 'Edit' : 'New role' }: {
  role?: RoleDef;
  permissions: PermissionDef[];
  save: (input: RoleInput, reason: string) => Promise<ActionResult>;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role?.label ?? '');
  const [key, setKey] = useState(role?.key ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const areas = [...new Set(permissions.map((p) => p.area))];
  const isNew = !role;
  const reset = () => {
    setName(role?.label ?? ''); setKey(role?.key ?? ''); setDescription(role?.description ?? ''); setPerms(role?.permissions ?? []); setReason(''); setError(null);
  };
  const submit = () =>
    start(async () => {
      const r = await save({ key: key || name, label: name, description, permissions: perms }, reason);
      if (r.ok) { toast(r.message ?? 'Saved'); setOpen(false); router.refresh(); } else setError(r.error);
    });
  return (
    <>
      <Button variant={isNew ? 'primary' : 'secondary'} size="sm" onClick={() => { reset(); setOpen(true); }}>
        <Icon name={isNew ? 'plus' : 'edit'} size={16} /> {label}
      </Button>
      <Modal open={open} onClose={() => !pending && setOpen(false)} title={isNew ? 'New role' : `Edit ${role.label}`} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="type-label">Name</span>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} disabled={role?.is_system} maxLength={40} placeholder="Night shift" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="type-label">Key</span>
            <input className={cx(inputClass, 'font-mono text-[14px]')} value={key || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}
              onChange={(e) => setKey(e.target.value)} disabled={!isNew} maxLength={32} />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="type-label">What it is for</span>
            <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Moderation and support overnight" />
          </label>
        </div>
        <div className="flex flex-col gap-4 max-h-[42vh] overflow-y-auto -mx-1 px-1">
          {areas.map((area) => (
            <fieldset key={area} className="flex flex-col gap-1">
              <legend className="type-micro uppercase tracking-[0.08em] text-subtle pb-2">{area}</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {permissions.filter((p) => p.area === area).map((p) => {
                  const on = perms.includes(p.key);
                  return (
                    <label key={p.key} className={cx('flex items-start gap-3 rounded-md px-3 py-2.5 cursor-pointer', on ? 'bg-primary-soft' : 'bg-surface-alt')}>
                      <input type="checkbox" checked={on} onChange={() => setPerms((c) => (on ? c.filter((x) => x !== p.key) : [...c, p.key]))} className="mt-0.5 h-5 w-5 accent-[var(--lf-primary-fill)]" />
                      <span className="flex flex-col">
                        <span className="type-body-strong">{p.label}</span>
                        <span className="type-caption text-muted">{p.help}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span className="type-label">Reason (recorded in the audit log)</span>
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why this change" />
        </label>
        {error ? <p role="alert" className="type-caption text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || reason.trim().length < 5 || name.trim().length < 2} arrow>{isNew ? 'Create role' : 'Save role'}</Button>
        </div>
      </Modal>
    </>
  );
}
