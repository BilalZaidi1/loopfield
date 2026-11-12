'use client';

import { useMemo, useState } from 'react';
import type { RuleDef, RuleFamily } from '@/lib/types';
import type { ActionResult } from '@/lib/errors';
import { Badge, Card, cx, inputClass } from '@/components/ui';
import { ActionButton } from '@/components/client';

/** Display units: metres stay metres, areas in km², speeds in km/h, shares in %. */
const UNIT: Record<RuleDef['unit'], { label: string; to: (v: number) => number; from: (v: number) => number; digits: number }> = {
  m: { label: 'm', to: (v) => v, from: (v) => v, digits: 0 },
  m2: { label: 'km²', to: (v) => v / 1e6, from: (v) => v * 1e6, digits: 2 },
  s: { label: 's', to: (v) => v, from: (v) => v, digits: 1 },
  'm/s': { label: 'km/h', to: (v) => v * 3.6, from: (v) => v / 3.6, digits: 1 },
  share: { label: '%', to: (v) => v * 100, from: (v) => v / 100, digits: 1 },
  ratio: { label: '', to: (v) => v, from: (v) => v, digits: 3 },
  count: { label: '', to: (v) => v, from: (v) => v, digits: 0 }
};
const show = (r: RuleDef, v: number) => +UNIT[r.unit].to(v).toFixed(UNIT[r.unit].digits);
const fmt = (r: RuleDef, v: number) => `${new Intl.NumberFormat('en', { maximumFractionDigits: UNIT[r.unit].digits }).format(show(r, v))}${UNIT[r.unit].label ? ` ${UNIT[r.unit].label}` : ''}`;

export function RulesForm({ family, catalog, next, running, canEdit, canApply, save, saveAndApply }: {
  family: RuleFamily;
  catalog: RuleDef[];
  /** Values of the version the next season starts with. */
  next: Record<string, number>;
  /** Values the main running season uses. */
  running: Record<string, number>;
  canEdit: boolean;
  canApply: boolean;
  save: (family: RuleFamily, values: Record<string, number>, reason: string) => Promise<ActionResult>;
  saveAndApply: (family: RuleFamily, values: Record<string, number>, reason: string) => Promise<ActionResult>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(catalog.map((r) => [r.key, String(show(r, next[r.key] ?? r.default))])));
  const groups = [...new Set(catalog.map((r) => r.group))];
  const parsed = useMemo(() => {
    const values: Record<string, number> = {};
    const errors: Record<string, string> = {};
    for (const r of catalog) {
      const n = Number(draft[r.key]);
      if (draft[r.key] === '' || !Number.isFinite(n)) { errors[r.key] = 'Enter a number'; continue; }
      const raw = +UNIT[r.unit].from(n).toFixed(6);
      if (raw < r.min - 1e-9 || raw > r.max + 1e-9) errors[r.key] = `Between ${fmt(r, r.min)} and ${fmt(r, r.max)}`;
      values[r.key] = raw;
    }
    if (family === 'territory' && values.minLoopLengthMeters != null && values.maxLoopLengthMeters != null && values.minLoopLengthMeters >= values.maxLoopLengthMeters) errors.minLoopLengthMeters = 'Must be shorter than the maximum';
    if (family === 'speed' && values.minCourseLengthMeters != null && values.maxCourseLengthMeters != null && values.minCourseLengthMeters >= values.maxCourseLengthMeters) errors.minCourseLengthMeters = 'Must be shorter than the longest route';
    return { values, errors };
  }, [draft, catalog, family]);
  const changedFromNext = catalog.filter((r) => Math.abs((parsed.values[r.key] ?? NaN) - (next[r.key] ?? r.default)) > 1e-9);
  const invalid = Object.keys(parsed.errors).length > 0;
  const summary = changedFromNext.map((r) => `${r.label}: ${fmt(r, next[r.key] ?? r.default)} → ${fmt(r, parsed.values[r.key]!)}`);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-4">
        {groups.map((g) => (
          <Card key={g} title={g}>
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-10 [&>div]:border-b [&>div]:border-line lg:[&>div:nth-last-child(-n+2):nth-child(odd)]:border-b-0 [&>div:last-child]:border-b-0">
              {catalog.filter((r) => r.group === g).map((r) => {
                const value = parsed.values[r.key];
                const isDefault = value != null && Math.abs(value - r.default) < 1e-9;
                const differsFromRunning = value != null && Math.abs(value - (running[r.key] ?? r.default)) > 1e-9;
                return (
                  <div key={r.key} className="py-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-x-4 gap-y-2 items-start">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <label htmlFor={`rule-${r.key}`} className="type-body-strong">{r.label}</label>
                      <p className="type-caption text-muted">{r.help}</p>
                      <p className="type-caption text-subtle">
                        Built-in {fmt(r, r.default)}{differsFromRunning ? <> · running season {fmt(r, running[r.key] ?? r.default)}</> : null}
                      </p>
                    </div>
                    <div className="flex flex-col items-start sm:items-end gap-1">
                      <div className="flex items-center gap-2">
                        <input id={`rule-${r.key}`} inputMode="decimal" disabled={!canEdit} value={draft[r.key] ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                          aria-invalid={Boolean(parsed.errors[r.key])}
                          className={cx(inputClass, 'w-32 text-right tabular-nums', parsed.errors[r.key] && 'border-danger')} />
                        <span className="type-label text-muted w-10">{UNIT[r.unit].label}</span>
                      </div>
                      {parsed.errors[r.key] ? <span className="type-caption text-danger">{parsed.errors[r.key]}</span> : !isDefault ? <Badge label="Changed from built-in" tone="violet" /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </section>
      {canEdit ? (
        <div className="sticky bottom-3 z-20 rounded-lg bg-surface shadow-floating p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="type-caption text-muted min-w-0 flex-1">
            {changedFromNext.length ? `${changedFromNext.length} change${changedFromNext.length === 1 ? '' : 's'} from the next season’s rules.` : 'No changes from the next season’s rules.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <ActionButton label="Save for next season" variant="primary" disabled={invalid || !changedFromNext.length}
              title="Save these rules for the next season?"
              description={<>The running season keeps its rules, so everyone in it plays by the same rules.<ul className="mt-2 list-disc pl-5">{summary.map((s) => <li key={s}>{s}</li>)}</ul></>}
              action={(reason) => save(family, parsed.values, reason)} />
            {canApply ? (
              <ActionButton label="Save and apply now" variant="danger" disabled={invalid}
                title="Apply to running seasons now?"
                description={<>Runs started from now on use these rules; runs already recorded keep theirs. Players in the running season will be judged by different rules than earlier in the season.{summary.length ? <ul className="mt-2 list-disc pl-5">{summary.map((s) => <li key={s}>{s}</li>)}</ul> : null}</>}
                confirmPhrase="APPLY" action={(reason) => saveAndApply(family, parsed.values, reason)} />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
