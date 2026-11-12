'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { PostgreSQL, sql as sqlLang } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { SavedQuery, SqlResult, SqlSaved, SqlView } from '@/lib/types';
import type { ActionResult } from '@/lib/errors';
import { Badge, Button, cx, inputClass } from '@/components/ui';
import { toast } from '@/components/client';
import { Icon } from '@/components/icons';

const EXAMPLES: { name: string; sql: string }[] = [
  { name: 'Runs per day, last 14 days', sql: "select date_trunc('day', started_at)::date as day, count(*) as runs, round(sum(distance_m)::numeric / 1000, 1) as km\n  from runs\n where started_at > now() - interval '14 days' and deleted_at is null\n group by 1\n order by 1" },
  { name: 'Why loops are not counted', sql: "select reason, count(*) as loops\n  from loop_claims, unnest(reasons) as reason\n where status in ('unranked', 'invalid') and created_at > now() - interval '30 days'\n group by 1\n order by 2 desc" },
  { name: 'Most active runners this week', sql: "select r.handle, count(*) as runs, round(sum(x.distance_m)::numeric / 1000, 1) as km\n  from runs x join runners r on r.id = x.user_id\n where x.started_at > now() - interval '7 days' and x.deleted_at is null\n group by 1\n order by 2 desc\n limit 20" },
  { name: 'Support: first reply time by topic', sql: "select category, count(*) as conversations,\n       round(avg(extract(epoch from first_response_at - created_at) / 60)::numeric, 1) as avg_minutes\n  from support_tickets\n where created_at > now() - interval '30 days'\n group by 1\n order by 2 desc" },
  { name: 'Daily metrics', sql: "select day, metric, value\n  from metrics_daily\n where day > current_date - 7\n order by day desc, metric" }
];

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--lf-primary)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--lf-green-text)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--lf-orange-text)' },
  { tag: t.comment, color: 'var(--lf-text-subtle)', fontStyle: 'italic' },
  { tag: [t.typeName, t.function(t.variableName)], color: 'var(--lf-blue-text)' },
  { tag: t.operator, color: 'var(--lf-text-muted)' }
]);

const theme = EditorView.theme({
  '&': { fontSize: '14px', backgroundColor: 'var(--lf-surface)', color: 'var(--lf-text)', borderRadius: '16px', border: '1px solid var(--lf-border-strong)' },
  '&.cm-focused': { outline: '2px solid var(--lf-primary)', outlineOffset: '-1px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', minHeight: '220px', maxHeight: '50vh' },
  '.cm-content': { caretColor: 'var(--lf-primary)', padding: '12px 0' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--lf-text-subtle)', border: 'none', borderTopLeftRadius: '16px', borderBottomLeftRadius: '16px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in oklab, var(--lf-primary-soft) 55%, transparent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--lf-primary-soft) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--lf-surface)', border: '1px solid var(--lf-border)', borderRadius: '12px', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--lf-primary-soft)', color: 'var(--lf-on-primary-soft)' }
});

function toCsv(r: SqlResult): string {
  const cell = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [r.columns.map(cell).join(','), ...r.rows.map((row) => row.map(cell).join(','))].join('\n') + '\n';
}

function show(v: unknown): string {
  if (v == null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function SqlEditor({ catalog, saved, run, save, remove }: {
  catalog: SqlView[];
  saved: SqlSaved;
  run: (sql: string, limit: number) => Promise<{ ok: true; result: SqlResult } | { ok: false; error: string }>;
  save: (id: string | null, name: string, sql: string, shared: boolean) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const runRef = useRef<() => void>(() => {});
  const [limit, setLimit] = useState(200);
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState<SavedQuery | null>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [tab, setTab] = useState<'schema' | 'saved' | 'history'>('schema');
  const [filter, setFilter] = useState('');
  const schema = useMemo(() => Object.fromEntries(catalog.map((v) => [v.name, v.columns.map((c) => c.name)])), [catalog]);

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: EXAMPLES[0]!.sql,
        extensions: [
          basicSetup,
          sqlLang({ dialect: PostgreSQL, schema, upperCaseKeywords: false }),
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { runRef.current(); return true; } }]))
        ]
      })
    });
    view.current = v;
    return () => v.destroy();
  }, [schema]);

  const text = () => view.current?.state.doc.toString() ?? '';
  const setText = (s: string) => view.current?.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: s } });
  const insert = (s: string) => {
    const v = view.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    v.dispatch({ changes: { from, to, insert: s }, selection: { anchor: from + s.length } });
    v.focus();
  };
  const execute = () =>
    start(async () => {
      setError(null);
      const r = await run(text(), limit);
      if (!r.ok) { setError(r.error); setResult(null); return; }
      if (r.result.error) { setError(`${r.result.error}${r.result.hint ? ` (${r.result.hint})` : ''}`); setResult(null); return; }
      setResult(r.result);
      router.refresh();
    });
  useEffect(() => {
    runRef.current = execute;
  });

  const download = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCsv(result)], { type: 'text/csv' }));
    a.download = `${(current?.name ?? 'query').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doSave = () =>
    start(async () => {
      const r = await save(current?.mine ? current.id : null, name || current?.name || 'Untitled query', text(), shared);
      if (r.ok) { toast(r.message ?? 'Saved'); router.refresh(); } else toast(r.error, 'danger');
    });

  const views = catalog.filter((v) => !filter || v.name.includes(filter.toLowerCase()) || v.columns.some((c) => c.name.includes(filter.toLowerCase())));

  return (
    <div className="grid grid-cols-12 gap-4 items-start">
      <div className="col-span-12 xl:col-span-8 flex flex-col gap-4 min-w-0">
        <div className="rounded-lg bg-surface p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <input aria-label="Query name" className={cx(inputClass, 'min-h-10 w-56')} placeholder={current?.name ?? 'Untitled query'} value={name} onChange={(e) => setName(e.target.value)} />
              <label className="inline-flex items-center gap-2 type-label text-muted"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="h-4 w-4 accent-[var(--lf-primary-fill)]" /> Share with staff</label>
              <Button variant="ghost" size="sm" onClick={doSave} disabled={pending}><Icon name="save" size={16} /> Save</Button>
            </div>
            <div className="flex items-center gap-2">
              <select aria-label="Row limit" value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="border border-line-strong rounded-md px-2 min-h-10 type-label bg-surface text-ink">
                {[50, 200, 500, 1000].map((n) => <option key={n} value={n}>{n} rows</option>)}
              </select>
              <Button onClick={execute} disabled={pending}><Icon name="play" size={16} /> {pending ? 'Running…' : 'Run'}</Button>
            </div>
          </div>
          <div ref={host} className="min-w-0" />
          <p className="type-caption text-muted">Read-only: queries run against the curated views on the right, are capped at {limit} rows and the request timeout, and are recorded in the audit log. Ctrl or ⌘ + Enter runs.</p>
        </div>

        <div className="rounded-lg bg-surface flex flex-col min-w-0" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
            <h2 className="type-heading">Results</h2>
            {result ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge label={`${result.row_count} row${result.row_count === 1 ? '' : 's'}${result.truncated ? ` (first ${result.limit})` : ''}`} tone={result.truncated ? 'warning' : 'muted'} />
                <Badge label={`${result.ms} ms`} tone="muted" />
                <Button variant="ghost" size="sm" onClick={download}><Icon name="download" size={16} /> CSV</Button>
                <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(toCsv(result)).then(() => toast('Copied as CSV'))}><Icon name="copy" size={16} /> Copy</Button>
              </div>
            ) : null}
          </div>
          {error ? <div role="alert" className="mx-5 mb-5 rounded-md bg-danger-soft text-danger px-4 py-3 type-body font-mono text-[13px] whitespace-pre-wrap">{error}</div> : null}
          {result ? (
            result.columns.length ? (
              <div className="overflow-auto max-h-[60vh] border-t border-line">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 bg-surface z-10">
                    <tr className="border-b border-line">
                      <th scope="col" className="type-caption text-subtle font-semibold py-2 pl-5 pr-3 text-right w-12">#</th>
                      {result.columns.map((c, i) => <th key={`${c}-${i}`} scope="col" className="type-caption text-subtle font-semibold py-2 pr-4 whitespace-nowrap">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[13px]">
                    {result.rows.map((row, i) => (
                      <tr key={i} className="border-b border-line last:border-b-0 hover:bg-surface-alt/60">
                        <td className="py-1.5 pl-5 pr-3 text-right text-subtle tabular-nums">{i + 1}</td>
                        {row.map((v, j) => (
                          <td key={j} className={cx('py-1.5 pr-4 align-top max-w-[420px] truncate', v == null && 'text-subtle italic', typeof v === 'number' && 'text-right tabular-nums')} title={show(v)}>{show(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="type-body text-muted px-5 pb-5">The query returned no rows.</p>
          ) : !error ? <p className="type-body text-muted px-5 pb-5">Run a query to see rows here.</p> : null}
        </div>
      </div>

      <aside className="col-span-12 xl:col-span-4 rounded-lg bg-surface p-4 flex flex-col gap-3 min-w-0 xl:sticky xl:top-20">
        <div role="tablist" aria-label="Side panel" className="inline-flex self-start rounded-full bg-surface-sunken p-1">
          {([['schema', 'Tables'], ['saved', `Saved · ${saved.queries.length}`], ['history', 'History']] as const).map(([v, l]) => (
            <button key={v} role="tab" type="button" aria-selected={tab === v} onClick={() => setTab(v)}
              className={cx('rounded-full px-3 min-h-9 type-label', tab === v ? 'bg-surface text-ink shadow-raised' : 'text-muted')}>{l}</button>
          ))}
        </div>
        {tab === 'schema' ? (
          <>
            <input aria-label="Filter tables" placeholder="Filter tables and columns" value={filter} onChange={(e) => setFilter(e.target.value)} className={cx(inputClass, 'min-h-10')} />
            <ul className="flex flex-col gap-1 max-h-[62vh] overflow-y-auto -mx-1 px-1">
              {views.map((v) => (
                <li key={v.name}>
                  <details className="group rounded-md">
                    <summary className="flex items-center gap-2 cursor-pointer rounded-md px-2 min-h-10 hover:bg-surface-alt list-none">
                      <Icon name="chevron" size={14} className="text-subtle transition-transform group-open:rotate-90" />
                      <span className="type-body-strong font-mono text-[13px] flex-1 truncate">{v.name}</span>
                      <button type="button" onClick={(e) => { e.preventDefault(); insert(v.name); }} className="type-caption text-primary px-1">insert</button>
                    </summary>
                    {v.comment ? <p className="type-caption text-muted px-8 pb-1">{v.comment}</p> : null}
                    <ul className="pb-2">
                      {v.columns.map((c) => (
                        <li key={c.name}>
                          <button type="button" onClick={() => insert(c.name)} className="w-full flex items-center justify-between gap-2 pl-8 pr-2 py-1 rounded-sm hover:bg-surface-alt text-left">
                            <span className="font-mono text-[12px] text-ink truncate">{c.name}</span>
                            <span className="font-mono text-[11px] text-subtle truncate">{c.type}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          </>
        ) : tab === 'saved' ? (
          <ul className="flex flex-col gap-1 max-h-[66vh] overflow-y-auto">
            {[...saved.queries.map((q) => ({ ...q, example: false })), ...EXAMPLES.map((e, i) => ({ id: `ex-${i}`, name: e.name, sql: e.sql, shared: true, mine: false, owner: null, updated_at: '', example: true }))].map((q) => (
              <li key={q.id} className="flex items-center gap-2 rounded-md px-2 min-h-11 hover:bg-surface-alt">
                <button type="button" className="flex-1 min-w-0 text-left" onClick={() => { setText(q.sql); setCurrent(q.example ? null : q); setName(q.example ? '' : q.name); setShared(q.shared); }}>
                  <span className="block type-body-strong truncate">{q.name}</span>
                  <span className="block type-caption text-muted truncate">{q.example ? 'Example' : q.mine ? (q.shared ? 'Yours · shared' : 'Yours') : `Shared by @${q.owner ?? 'staff'}`}</span>
                </button>
                {q.mine ? (
                  <button type="button" aria-label={`Delete ${q.name}`} className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted hover:text-danger hover:bg-surface"
                    onClick={() => start(async () => { const r = await remove(q.id); if (r.ok) { toast('Deleted'); router.refresh(); } else toast(r.error, 'danger'); })}>
                    <Icon name="trash" size={16} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-1 max-h-[66vh] overflow-y-auto">
            {saved.history.length ? saved.history.map((h, i) => (
              <li key={i}>
                <button type="button" onClick={() => setText(h.sql)} className="w-full text-left rounded-md px-2 py-2 hover:bg-surface-alt flex flex-col gap-1">
                  <code className="font-mono text-[12px] text-ink line-clamp-2 break-all">{h.sql}</code>
                  <span className={cx('type-caption', h.error ? 'text-danger' : 'text-muted')}>{h.error ? h.error : `${h.rows ?? 0} rows · ${h.ms ?? 0} ms`} · {new Date(h.at).toLocaleString()}</span>
                </button>
              </li>
            )) : <li className="type-caption text-muted px-2">No queries yet.</li>}
          </ul>
        )}
      </aside>
    </div>
  );
}
