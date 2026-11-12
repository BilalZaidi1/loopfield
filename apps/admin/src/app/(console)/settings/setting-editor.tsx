'use client';

import { useMemo, useState } from 'react';
import { INTEGRITY_RULES } from '@loopfield/core';
import type { ConfigRow } from '@/lib/types';
import { DANGEROUS_KEYS, formatValue, validateConfigValue } from '@/lib/config-validate';
import { asMaintenance } from '@/lib/switches';
import { ActionButton, ReasonSwitch } from '@/components/client';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { setConfig } from './actions';

const input = 'border border-line-strong focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary rounded-md px-4 min-h-12 type-body bg-surface text-ink w-full';

/** Picks the right control for a setting's type; every save asks for a reason. */
export function SettingEditor({ row, rateLimits }: { row: ConfigRow; rateLimits?: RateLimitDef[] }) {
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
  if (row.key === 'rate_limits') return <OptionalNumbersEditor row={row} fields={(rateLimits ?? []).map((r) => ({ key: r.action, label: r.label, placeholder: String(r.default), min: 1, max: 10000, integer: true, suffix: r.window_seconds >= 86400 ? '/ day' : '/ hour' }))} />;
  if (row.key === 'integrity_overrides') return <OptionalNumbersEditor row={row} fields={INTEGRITY_FIELDS} stampVersion />;
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

const NEEDS: Record<string, string> = { admin: 'Admin', territory_operator: 'Kill switches', config: 'App settings', monetization: 'Monetization' };

function ReadOnly({ row }: { row: ConfigRow }) {
  return (
    <div className="flex items-center gap-2 type-label">
      <span className="tabular truncate max-w-[280px]">{formatValue(row.value)}</span>
      <span className="inline-flex items-center gap-1 type-caption text-muted" title={`Needs the ${NEEDS[row.min_role] ?? row.min_role} permission`}>
        <Icon name="lock" size={14} /> {NEEDS[row.min_role] ?? row.min_role}
      </span>
    </div>
  );
}

export interface RateLimitDef {
  action: string;
  label: string;
  default: number;
  window_seconds: number;
}

interface OptionalField {
  key: string;
  label: string;
  placeholder: string;
  min: number;
  max: number;
  integer?: boolean;
  suffix?: string;
}

/** Bounds match integrityRulesWith in packages/core/src/integrity/speed.ts (the database checks them too). */
const INTEGRITY_FIELDS: OptionalField[] = (
  [
    ['envelopeMargin', 'Speed envelope margin', 1, 1.5, false, '×'],
    ['isolatedSpikeMaxFixes', 'GPS spikes ignored', 0, 5, true, 'points'],
    ['smoothingFixes', 'Speed smoothing', 1, 15, true, 'points'],
    ['liveWarnSeconds', 'Live warning after', 10, 300, true, 's'],
    ['liveImpossiblePauseSeconds', 'Pause after impossible speed', 20, 600, true, 's'],
    ['liveVehiclePauseSeconds', 'Pause after vehicle speed', 30, 900, true, 's'],
    ['liveWindowSeconds', 'Live check window', 60, 900, true, 's'],
    ['stepsMinSpeedMetersPerSecond', 'Step check from', 2, 5, false, 'm/s'],
    ['stepsMinCadence', 'Lowest running cadence', 40, 160, true, 'spm'],
    ['stepsFlagSeconds', 'Flag after no steps for', 30, 600, true, 's'],
    ['stepsPauseSeconds', 'Pause after no steps for', 60, 1800, true, 's']
  ] as const
).map(([key, label, min, max, integer, suffix]) => ({
  key, label, min, max, integer, suffix,
  placeholder: String((INTEGRITY_RULES as unknown as Record<string, { value: number }>)[key]?.value ?? '')
}));

/** Numbers where an empty field means "use the built-in value" (the key is left out). */
function OptionalNumbersEditor({ row, fields, stampVersion }: { row: ConfigRow; fields: OptionalField[]; stampVersion?: boolean }) {
  const initial = useMemo(() => (row.value && typeof row.value === 'object' && !Array.isArray(row.value) ? row.value : {}) as Record<string, unknown>, [row.value]);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, initial[f.key] == null ? '' : String(initial[f.key])])));
  const numbers = useMemo(() => {
    const out: Record<string, number> = {};
    for (const f of fields) {
      const t = (draft[f.key] ?? '').trim();
      if (t !== '') out[f.key] = Number(t);
    }
    return out;
  }, [draft, fields]);
  const error = fields.map((f) => {
    const n = numbers[f.key];
    if (n === undefined) return null;
    if (!Number.isFinite(n)) return `${f.label}: enter a number`;
    if (f.integer && !Number.isInteger(n)) return `${f.label}: use a whole number`;
    if (n < f.min || n > f.max) return `${f.label}: between ${f.min} and ${f.max}`;
    return null;
  }).find(Boolean) ?? null;
  const same = (a: Record<string, unknown>, b: Record<string, unknown>) => fields.every((f) => (a[f.key] ?? null) === (b[f.key] ?? null));
  const changed = !same(numbers, initial);
  const value = useMemo(() => {
    const kept = Object.fromEntries(Object.entries(initial).filter(([k]) => !fields.some((f) => f.key === k)));
    const stamp = stampVersion && changed ? { version: `ops-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}` } : {};
    return { ...kept, ...numbers, ...stamp };
  }, [initial, numbers, fields, stampVersion, changed]);
  return (
    <div className="flex flex-col gap-3 w-full lg:max-w-[560px]">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 min-w-0">
            <span className="type-caption text-muted truncate">{f.label}</span>
            <span className="flex items-center gap-2">
              <input className={cx(input, 'tabular text-right')} inputMode="decimal" placeholder={f.placeholder} value={draft[f.key] ?? ''}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              {f.suffix ? <span className="type-caption text-muted w-12 shrink-0">{f.suffix}</span> : null}
            </span>
          </label>
        ))}
      </div>
      <p className="type-caption text-subtle">Empty fields use the built-in value shown in grey.</p>
      <div className="flex items-center gap-3">
        <SaveButton row={row} value={value} error={error} changed={changed} />
        <Hint error={changed ? error : null} />
      </div>
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
