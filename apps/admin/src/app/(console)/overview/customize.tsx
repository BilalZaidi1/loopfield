'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { WidgetBand, WidgetDef } from '@/lib/widgets';
import type { ActionResult } from '@/lib/errors';
import { Button, cx } from '@/components/ui';
import { Modal, toast } from '@/components/client';
import { Icon } from '@/components/icons';

const BAND_LABEL: Record<WidgetBand, string> = { tile: 'Numbers', chart: 'Charts', panel: 'Panels' };

/** Pick and order the Overview's widgets. Saved for this staff member only. */
export function CustomizeOverview({ available, selected, save, reset }: {
  available: WidgetDef[];
  selected: string[];
  save: (ids: string[]) => Promise<ActionResult>;
  reset: () => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>(selected);
  const [pending, start] = useTransition();
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const move = (id: string, dir: -1 | 1) =>
    setIds((cur) => {
      const band = available.find((w) => w.id === id)?.band;
      const same = cur.filter((x) => available.find((w) => w.id === x)?.band === band);
      const j = same.indexOf(id) + dir;
      if (j < 0 || j >= same.length) return cur;
      const other = same[j]!;
      return cur.map((x) => (x === id ? other : x === other ? id : x));
    });
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(r.message ?? 'Saved');
        setOpen(false);
        router.refresh();
      } else toast(r.error, 'danger');
    });

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => { setIds(selected); setOpen(true); }}>
        <Icon name="grid" size={16} /> Customize
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Customize the Overview">
        <p className="type-body text-muted">Choose what you see and in which order. Only you see this layout.</p>
        <div className="flex flex-col gap-5 max-h-[60vh] overflow-y-auto -mx-1 px-1">
          {(['tile', 'chart', 'panel'] as WidgetBand[]).map((band) => {
            const inBand = available.filter((w) => w.band === band);
            const order = [...ids.filter((id) => inBand.some((w) => w.id === id)), ...inBand.filter((w) => !ids.includes(w.id)).map((w) => w.id)];
            if (!inBand.length) return null;
            return (
              <fieldset key={band} className="flex flex-col gap-1">
                <legend className="type-micro uppercase tracking-[0.08em] text-subtle pb-2">{BAND_LABEL[band]}</legend>
                {order.map((id) => {
                  const w = inBand.find((x) => x.id === id)!;
                  const on = ids.includes(id);
                  return (
                    <div key={id} className={cx('flex items-center gap-3 rounded-md px-3 min-h-12', on ? 'bg-primary-soft' : 'bg-surface-alt')}>
                      <input id={`w-${id}`} type="checkbox" checked={on} onChange={() => toggle(id)} className="h-5 w-5 accent-[var(--lf-primary-fill)]" />
                      <label htmlFor={`w-${id}`} className="type-body-strong flex-1 min-w-0 truncate">{w.label}</label>
                      {on ? (
                        <span className="flex gap-1">
                          <button type="button" aria-label={`Move ${w.label} up`} onClick={() => move(id, -1)} className="h-9 w-9 rounded-full hover:bg-surface inline-flex items-center justify-center rotate-[-90deg]"><Icon name="chevron" size={16} /></button>
                          <button type="button" aria-label={`Move ${w.label} down`} onClick={() => move(id, 1)} className="h-9 w-9 rounded-full hover:bg-surface inline-flex items-center justify-center rotate-90"><Icon name="chevron" size={16} /></button>
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
        </div>
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <Button variant="ghost" onClick={() => run(reset)} disabled={pending}>Reset to default</Button>
          <Button onClick={() => run(() => save(ids))} disabled={pending} arrow>Save layout</Button>
        </div>
      </Modal>
    </>
  );
}
