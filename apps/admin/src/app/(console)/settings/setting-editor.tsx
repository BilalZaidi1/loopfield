'use client';

import { useMemo, useState } from 'react';
import type { ConfigRow } from '@/lib/types';
import { DANGEROUS_KEYS, formatValue, validateConfigValue } from '@/lib/config-validate';
import { asMaintenance } from '@/lib/switches';
import { ActionButton, ReasonSwitch } from '@/components/client';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { setConfig } from './actions';

const input = 'border border-line-strong focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary rounded-md px-4 min-h-12 type-body bg-surface text-ink w-full';

/** Picks the right control for a setting's type; every save asks for a reason. */
export function SettingEditor({ row }: { row: ConfigRow }) {
  if (!row.can_edit) return <ReadOnly row={row} />;
  const dangerous = DANGEROUS_KEYS.has(row.key);
  if (row.value_type === 'boolean' && !dangerous) {
    return (
      <ReasonSwitch
        checked={row.value === true}
        label={row.label}
        action={(next, reason) => setConfig(row.key, next, reason)}
        describe={(next) => (row.category === 'switch' && !next ? `${row.help ?? ''} Takes effect on the server immediately.` : row.help)}
      />
    );
  }
  if (row.value_type === 'boolean') return <DangerousToggle row={row} />;
  if (row.key === 'maintenance_mode') return <MaintenanceEditor row={row} />;
  if (row.key === 'latest_app_version') return <FieldsEditor row={row} fields={['ios', 'android']} kind="version" />;
  if (row.key === 'achievement_tier_points') return <FieldsEditor row={row} fields={['bronze', 'silver', 'gold', 'platinum']} kind="number" />;
  switch (row.value_type) {
    case 'integer':
    case 'number':
      return <ScalarEditor row={row} kind="number" />;
    case 'version':
    case 'string':
      return row.allowed ? <SelectEditor row={row} /> : <ScalarEditor row={row} kind="text" />;
    case 'string_array':
      return <ListEditor row={row} />;
    default:
      return <JsonEditor row={row} />;
  }
}

function ReadOnly({ row }: { row: ConfigRow }) {
  return (
    <div className="flex items-center gap-2 type-label">
      <span className="tabular">{formatValue(row.value)}</span>
      <span className="inline-flex items-center gap-1 type-caption text-muted" title={`Needs the ${row.min_role === 'admin' ? 'admin' : 'territory operator'} role`}>
        <Icon name="lock" size={14} /> {row.min_role === 'admin' ? 'Admin' : 'Operator'}
      </span>
    </div>
  );
}

function SaveButton({ row, value, error, changed, label = 'Save' }: { row: ConfigRow; value: unknown; error: string | null; changed: boolean; label?: string }) {
  return (
    <ActionButton
      label={label}
      size="sm"
      variant="primary"
      disabled={!changed || Boolean(error)}
      title={`Change ${row.label}`}
      description={<>From <b>{formatValue(row.value)}</b> to <b>{formatValue(value)}</b>. {row.help}</>}
      confirmPhrase={DANGEROUS_KEYS.has(row.key) ? row.key : undefined}
      action={(reason) => setConfig(row.key, value, reason)}
      successMessage={`${row.label} saved`}
    />
  );
}

function Hint({ error }: { error: string | null }) {
  return error ? <p className="type-caption text-danger" role="alert">{error}</p> : null;
}

function DangerousToggle({ row }: { row: ConfigRow }) {
  const on = row.value === true;
  return (
    <div className="flex items-center gap-3">
      <span className={cx('type-label', on ? 'text-success' : 'text-muted')}>{on ? 'On' : 'Off'}</span>
      <ActionButton
        label={on ? 'Turn off' : 'Turn on'}
        size="sm"
        variant={on ? 'ghost' : 'danger'}
        title={`${row.label}: turn ${on ? 'off' : 'on'}?`}
        description={row.help}
        confirmPhrase={row.key}
        action={(reason) => setConfig(row.key, !on, reason)}
        successMessage={`${row.label} turned ${on ? 'off' : 'on'}`}
      />
    </div>
  );
}

function ScalarEditor({ row, kind }: { row: ConfigRow; kind: 'number' | 'text' }) {
  const [text, setText] = useState(String(row.value ?? ''));
  const value = kind === 'number' ? (text.trim() === '' ? null : Number(text)) : text.trim();
  const error = validateConfigValue(row, value);
  return (
    <div className="flex flex-col gap-1 w-full sm:w-auto">
      <div className="flex items-center gap-2">
        <input
          aria-label={row.label}
          className={cx(input, 'sm:w-40 tabular', error && 'border-danger')}
          inputMode={kind === 'number' ? 'numeric' : 'text'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <SaveButton row={row} value={value} error={error} changed={value !== row.value} />
      </div>
      {kind === 'number' && row.min_value != null ? <p className="type-caption text-muted">{row.min_value} to {row.max_value}</p> : null}
      <Hint error={text !== String(row.value ?? '') ? error : null} />
    </div>
  );
}

function SelectEditor({ row }: { row: ConfigRow }) {
  const [value, setValue] = useState(String(row.value ?? ''));
  return (
    <div className="flex items-center gap-2">
      <select aria-label={row.label} className={cx(input, 'sm:w-48')} value={value} onChange={(e) => setValue(e.target.value)}>
        {(row.allowed ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <SaveButton row={row} value={value} error={validateConfigValue(row, value)} changed={value !== row.value} />
    </div>
  );
}

function ListEditor({ row }: { row: ConfigRow }) {
  const initial = Array.isArray(row.value) ? (row.value as string[]) : [];
  const [items, setItems] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');
  const error = validateConfigValue(row, items);
  const changed = JSON.stringify(items) !== JSON.stringify(initial);
  const add = () => {
    const v = draft.trim().toLowerCase();
    if (v && !items.includes(v)) setItems([...items, v]);
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-2 w-full sm:max-w-md">
      <div className="flex flex-wrap gap-1.5">
        {items.length ? items.map((it) => (
          <span key={it} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 type-label">
            {it}
            <button type="button" aria-label={`Remove ${it}`} onClick={() => setItems(items.filter((x) => x !== it))} className="text-muted hover:text-danger">
              <Icon name="x" size={12} />
            </button>
          </span>
        )) : <span className="type-caption text-muted">None</span>}
      </div>
      <div className="flex items-center gap-2">
        <input aria-label={`Add to ${row.label}`} placeholder={row.key === 'premium_features' ? 'feature_key' : 'card_key'} className={cx(input, 'font-mono text-[14px]')} value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-on-primary-soft" aria-label="Add">
          <Icon name="plus" size={18} />
        </button>
        <SaveButton row={row} value={items} error={error} changed={changed} />
      </div>
      <Hint error={changed ? error : null} />
    </div>
  );
}

function FieldsEditor({ row, fields, kind }: { row: ConfigRow; fields: string[]; kind: 'number' | 'version' }) {
  const initial = (row.value && typeof row.value === 'object' ? row.value : {}) as Record<string, unknown>;
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f, String(initial[f] ?? '')])));
  const value = useMemo(() => Object.fromEntries(fields.map((f) => [f, kind === 'number' ? Number(draft[f]) : (draft[f] ?? '').trim()])), [draft, fields, kind]);
  const error = validateConfigValue(row, value);
  const changed = fields.some((f) => String(initial[f] ?? '') !== draft[f]);
  return (
    <div className="flex flex-col gap-2 w-full sm:max-w-md">
      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => (
          <label key={f} className="flex flex-col gap-1">
            <span className="type-caption text-muted capitalize">{f === 'ios' ? 'iOS' : f}</span>
            <input className={cx(input, 'tabular')} inputMode={kind === 'number' ? 'numeric' : 'decimal'} value={draft[f] ?? ''}
              onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <SaveButton row={row} value={value} error={error} changed={changed} />
        <Hint error={changed ? error : null} />
      </div>
    </div>
  );
}

function MaintenanceEditor({ row }: { row: ConfigRow }) {
  const current = asMaintenance(row.value);
  const [enabled, setEnabled] = useState(current.enabled);
  const [message, setMessage] = useState(current.message ?? '');
  const [until, setUntil] = useState(current.until ? toLocalInput(current.until) : '');
  const value = { enabled, message: message.trim() || null, until: until ? new Date(until).toISOString() : null };
  const error = validateConfigValue(row, value);
  const changed = JSON.stringify(value) !== JSON.stringify({ enabled: current.enabled, message: current.message, until: current.until ? new Date(current.until).toISOString() : null });
  return (
    <div className="flex flex-col gap-3 w-full sm:max-w-md">
      <label className="flex items-center gap-2 type-label">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5 accent-[var(--lf-primary-fill)]" />
        Show the maintenance screen
      </label>
      <label className="flex flex-col gap-1">
        <span className="type-label">Message for runners</span>
        <textarea className={cx(input, 'py-2 min-h-20')} maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="We're upgrading Loopfield. Back by 3 pm." />
        <span className="type-caption text-muted">{message.length}/200</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="type-label">Expected back (optional)</span>
        <input type="datetime-local" className={input} value={until} onChange={(e) => setUntil(e.target.value)} />
      </label>
      <div className="flex items-center gap-3">
        <SaveButton row={row} value={value} error={error} changed={changed} label={enabled && !current.enabled ? 'Turn on maintenance' : 'Save'} />
        <Hint error={changed ? error : null} />
      </div>
    </div>
  );
}

function JsonEditor({ row }: { row: ConfigRow }) {
  const original = JSON.stringify(row.value, null, 2);
  const [text, setText] = useState(original);
  let parsed: unknown = undefined;
  let error: string | null = null;
  try {
    parsed = JSON.parse(text);
    error = row.value_type === 'object' || row.value_type === 'array' || row.value_type === 'null' ? (typeof parsed !== typeof row.value ? 'Keep the same JSON type' : validateConfigValue(row, parsed)) : null;
  } catch {
    error = 'Not valid JSON';
  }
  return (
    <div className="flex flex-col gap-2 w-full sm:max-w-md">
      <textarea aria-label={row.label} className={cx(input, 'py-2 min-h-28 font-mono text-[13px]', error && 'border-danger')} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="flex items-center gap-3">
        <SaveButton row={row} value={parsed} error={error} changed={text !== original} />
        <Hint error={text !== original ? error : null} />
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
