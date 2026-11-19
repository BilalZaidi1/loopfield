import { useId, type ReactNode } from 'react';
import { cellsInRect, mulberry32 } from '@/lib/hex';
import { metals, palette, territory } from '@/theme/brand';
import { Icon } from './Icon';

/*
 * The five app screens of the tour, drawn in HTML in the app's dark scheme with invented runners, clubs and places,
 * until real screenshots replace them (public/screens). Designed on a 280 × 600 screen.
 */

export type ScreenId = 'map' | 'record' | 'summary' | 'progress' | 'clubs';

function StatusBar() {
  return (
    <div className="flex h-9 items-center justify-between px-5 pt-1 text-[11px] font-bold text-ink">
      <span className="tabular">7:12</span>
      <span className="flex items-center gap-1.5" aria-hidden>
        <span className="flex items-end gap-[2px]">
          {[4, 6, 8, 10].map((h) => (
            <span key={h} className="w-[3px] rounded-sm bg-ink" style={{ height: h }} />
          ))}
        </span>
        <span className="relative h-[10px] w-[20px] rounded-[3px] ring-1 ring-ink/70">
          <span className="absolute inset-[2px] right-[5px] rounded-[1px] bg-ink" />
        </span>
      </span>
    </div>
  );
}

const tabs = [
  { id: 'map', icon: 'map', label: 'Map' },
  { id: 'record', icon: 'record', label: 'Record' },
  { id: 'progress', icon: 'progress', label: 'Progress' },
  { id: 'clubs', icon: 'clubs', label: 'Clubs' }
] as const;

function TabBar({ active }: { active: (typeof tabs)[number]['id'] }) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex h-[62px] items-start justify-around border-t border-white/[0.06] bg-bg/95 px-3 pt-2 backdrop-blur">
      {tabs.map((t) => (
        <span key={t.id} className={`flex flex-col items-center gap-0.5 text-[9.5px] font-bold ${t.id === active ? 'text-primary' : 'text-subtle'}`}>
          <Icon name={t.icon} size={20} />
          {t.label}
        </span>
      ))}
    </div>
  );
}

/** A patch of the shared map: your violet land, two rivals and a green route, on the app's hexagon grid. */
const mapCells = (() => {
  const rand = mulberry32(5);
  const blobs = [
    { x: 120, y: 250, r: 62, fill: territory.mineFill, op: 0.8 },
    { x: 210, y: 150, r: 46, fill: territory.rivalHues[0], op: territory.rivalOpacity },
    { x: 60, y: 400, r: 44, fill: territory.rivalHues[1], op: territory.rivalOpacity },
    { x: 220, y: 380, r: 36, fill: territory.rivalHues[2], op: territory.rivalOpacity }
  ];
  return cellsInRect(280, 600, 10.5, 12).flatMap(({ x, y }) => {
    const seed = rand();
    const b = blobs.find((bl) => Math.hypot(x - bl.x, y - bl.y) <= bl.r * (0.85 + seed * 0.3));
    return b ? [{ x, y, fill: b.fill, op: b.op, mine: b.fill === territory.mineFill }] : [];
  });
})();

const hexPoints = (cx: number, cy: number, s: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return `${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

function MapField({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg aria-hidden viewBox="0 0 280 600" preserveAspectRatio="xMidYMid slice" className={className}>
      <defs>
        <pattern id={id} width="18.19" height="31.5" patternUnits="userSpaceOnUse" x="-3" y="-6">
          <path d="M9.09 0 18.19 5.25v10.5L9.09 21 0 15.75V5.25zM9.09 21v10.5" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width="280" height="600" fill={palette.surface} />
      <rect width="280" height="600" fill={`url(#${id})`} />
      {mapCells.map((c) => (
        <polygon
          key={`${c.x}-${c.y}`}
          points={hexPoints(c.x, c.y, 9.2)}
          fill={c.fill}
          fillOpacity={c.op}
          stroke={c.mine ? territory.mineLine : c.fill}
          strokeOpacity={c.mine ? 0.9 : 0.55}
          strokeWidth="0.8"
        />
      ))}
      <path d="M-10 520 C 60 470, 90 470, 140 430 S 230 330, 300 300" fill="none" stroke={territory.routeCasing} strokeWidth="7" strokeLinecap="round" />
      <path d="M-10 520 C 60 470, 90 470, 140 430 S 230 330, 300 300" fill="none" stroke={territory.route} strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

function Pill({ children, tone = 'ghost' }: { children: ReactNode; tone?: 'ghost' | 'active' | 'violet' }) {
  const cls = tone === 'active' ? 'bg-ink text-block-ink' : tone === 'violet' ? 'bg-primary-soft text-on-primary-soft' : 'bg-bg/80 text-muted ring-1 ring-inset ring-white/10';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${cls}`}>{children}</span>;
}

function MapScreen() {
  return (
    <>
      <MapField className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-bg/90 to-transparent pb-6">
        <StatusBar />
        <div className="flex gap-1.5 px-4 pt-1">
          <Pill tone="active">Everyone</Pill>
          <Pill>City</Pill>
          <Pill>Friends</Pill>
          <Pill>Club</Pill>
        </div>
      </div>
      <span className="absolute left-[128px] top-[246px] grid size-4 place-items-center rounded-full bg-orange shadow-[0_0_0_6px_rgba(255,122,26,0.25)]" />
      <div className="absolute inset-x-2 bottom-[70px] rounded-[20px] bg-surface/95 p-3.5 shadow-[var(--lf-shadow-floating)] ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-extrabold text-ink">Riverside</p>
            <p className="text-[10.5px] font-semibold text-muted">You hold 184 cells here</p>
          </div>
          <Pill tone="violet">
            <Icon name="hexagon" size={11} /> Yours
          </Pill>
        </div>
        <div className="mt-3 flex h-9 items-center justify-center rounded-full bg-primary-fill text-[12px] font-bold text-white">Start territory run</div>
      </div>
      <TabBar active="map" />
    </>
  );
}

function RecordScreen() {
  return (
    <>
      <StatusBar />
      <div className="flex items-center justify-between px-4 pt-1">
        <Pill tone="violet">
          <Icon name="hexagon" size={11} /> Territory run
        </Pill>
        <span className="flex items-center gap-1 text-[10px] font-bold text-green-text">
          <span className="size-1.5 rounded-full bg-green" /> GPS good
        </span>
      </div>
      <div className="px-5 pt-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-subtle">Distance</p>
        <p className="font-display text-[76px] font-black italic leading-[0.9] tracking-[-0.04em] text-ink tabular">
          5.21<span className="ml-1 text-[18px] not-italic text-muted">km</span>
        </p>
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
          {[
            ['Time', '27:48'],
            ['Pace', '5:20 /km'],
            ['Cells', '+66'],
            ['Heart', 'on phone']
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-subtle">{k}</p>
              <p className={`mt-0.5 text-[20px] font-extrabold tracking-[-0.02em] tabular ${k === 'Cells' ? 'text-primary' : 'text-ink'}`}>{v}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="relative mx-4 mt-6 h-[150px] overflow-hidden rounded-[18px] ring-1 ring-white/10">
        <MapField className="absolute inset-0 h-full w-full scale-150" />
        <svg aria-hidden viewBox="0 0 248 150" className="absolute inset-0 h-full w-full">
          <path d="M70 110 C 40 80, 60 30, 120 28 S 210 50, 196 96 S 120 132, 92 122" fill="none" stroke={territory.routeCasing} strokeWidth="8" strokeLinecap="round" />
          <path d="M70 110 C 40 80, 60 30, 120 28 S 210 50, 196 96 S 120 132, 92 122" fill="none" stroke={territory.path} strokeWidth="4" strokeLinecap="round" />
          <path d="M92 122 L70 110" stroke={territory.closing} strokeWidth="4" strokeDasharray="2 6" strokeLinecap="round" />
          <circle cx="70" cy="110" r="5" fill={palette.surfaceSunken} stroke={territory.start} strokeWidth="2.5" />
          <circle cx="92" cy="122" r="5" fill={palette.orange} />
        </svg>
      </div>
      <div className="mt-6 flex items-center justify-center gap-5">
        <span className="grid size-12 place-items-center rounded-full bg-surface-alt text-ink">
          <span className="size-3.5 rounded-[3px] bg-ink" />
        </span>
        <span className="grid size-[68px] place-items-center rounded-full bg-orange text-block-ink shadow-[0_0_0_8px_rgba(255,122,26,0.18)]">
          <span className="flex gap-1.5">
            <span className="h-5 w-[5px] rounded-sm bg-block-ink" />
            <span className="h-5 w-[5px] rounded-sm bg-block-ink" />
          </span>
        </span>
        <span className="grid size-12 place-items-center rounded-full bg-surface-alt text-ink">
          <Icon name="map" size={18} />
        </span>
      </div>
    </>
  );
}

function SummaryScreen() {
  const splits = [5.45, 5.28, 5.12, 5.3, 5.18];
  return (
    <>
      <StatusBar />
      <div className="px-4 pt-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-subtle">Thu · 18:40</p>
        <p className="mt-1 text-[18px] font-extrabold tracking-[-0.02em] text-ink">Evening canal loop</p>
      </div>
      <div className="relative mx-4 mt-3 h-[190px] overflow-hidden rounded-[20px] ring-1 ring-white/10">
        <MapField className="absolute inset-0 h-full w-full scale-[1.7] [transform-origin:43%_42%]" />
        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between">
          <p className="font-display text-[44px] font-black italic leading-none tracking-[-0.03em] text-primary [text-shadow:0_2px_14px_rgba(11,12,14,0.9)]">
            +66
            <span className="ml-1.5 align-middle text-[10px] font-bold not-italic uppercase tracking-[0.14em] text-on-primary-soft">cells</span>
          </p>
          <Pill tone="active">
            <Icon name="check" size={11} /> Closed
          </Pill>
        </div>
      </div>
      <div className="mx-4 mt-3 grid grid-cols-3 gap-2">
        {[
          ['Distance', '5.21 km'],
          ['Time', '27:48'],
          ['Pace', '5:20']
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-surface px-2.5 py-2">
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-subtle">{k}</p>
            <p className="mt-0.5 text-[14px] font-extrabold text-ink tabular">{v}</p>
          </div>
        ))}
      </div>
      <div className="mx-4 mt-3 rounded-2xl bg-surface p-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-subtle">Splits</p>
        <ul className="mt-2 grid gap-1.5">
          {splits.map((s, i) => (
            <li key={i} className="flex items-center gap-2 text-[10.5px] font-bold text-muted tabular">
              <span className="w-3">{i + 1}</span>
              <span className="h-2 rounded-full bg-blue" style={{ width: `${(5.6 - s) * 260 + 40}px` }} />
              <span className="ml-auto text-ink">{`${Math.floor(s)}:${String(Math.round((s % 1) * 60)).padStart(2, '0')}`}</span>
            </li>
          ))}
        </ul>
      </div>
      <TabBar active="record" />
    </>
  );
}

function ProgressScreen() {
  const pct = 23.4 / 30;
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <>
      <StatusBar />
      <p className="px-4 pt-2 text-[18px] font-extrabold tracking-[-0.02em] text-ink">Progress</p>
      <div className="mx-4 mt-3 flex items-center gap-4 rounded-[20px] bg-surface p-4">
        <svg aria-hidden width="104" height="104" viewBox="0 0 104 104" className="shrink-0 -rotate-90">
          <circle cx="52" cy="52" r={r} fill="none" stroke={palette.greenSoft} strokeWidth="10" />
          <circle cx="52" cy="52" r={r} fill="none" stroke={palette.green} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />
        </svg>
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-green-text">Weekly goal</p>
          <p className="mt-1 font-display text-[30px] font-black italic leading-none text-ink tabular">23.4</p>
          <p className="text-[11px] font-semibold text-muted">of 30 km</p>
        </div>
      </div>
      <div className="mx-4 mt-3 rounded-[20px] bg-surface p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-subtle">Personal bests</p>
        <ul className="mt-2 divide-y divide-white/[0.06]">
          {[
            ['5K', '24:10'],
            ['10K', '51:37'],
            ['Longest run', '14.2 km']
          ].map(([k, v]) => (
            <li key={k} className="flex items-center justify-between py-2 text-[12px] font-bold">
              <span className="text-muted">{k}</span>
              <span className="text-ink tabular">{v}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mx-4 mt-3 rounded-[20px] bg-surface p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-magenta">Badges</p>
        <div className="mt-2.5 flex justify-between">
          {(['bronze', 'silver', 'gold', 'platinum'] as const).map((m) => (
            <svg key={m} aria-hidden width="44" height="44" viewBox="0 0 100 100">
              <defs>
                <linearGradient id={`mini-${m}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor={metals[m][0]} />
                  <stop offset="0.55" stopColor={metals[m][1]} />
                  <stop offset="1" stopColor={metals[m][2]} />
                </linearGradient>
              </defs>
              <path d="M50 3 90.7 26.5v47L50 97 9.3 73.5v-47z" fill={`url(#mini-${m})`} />
              <path d="M50 18 77.7 34v32L50 82 22.3 66V34z" fill="none" stroke={metals[m][0]} strokeOpacity="0.8" strokeWidth="3" />
            </svg>
          ))}
        </div>
      </div>
      <TabBar active="progress" />
    </>
  );
}

function ClubsScreen() {
  const standings = [
    { n: 1, name: 'Canal Crew', v: '1,410' },
    { n: 2, name: 'Night Owls RC', v: '1,240', you: true },
    { n: 3, name: 'Hill Harriers', v: '1,105' }
  ];
  return (
    <>
      <StatusBar />
      <div className="relative mx-4 mt-1 h-[92px] overflow-hidden rounded-[20px] bg-[linear-gradient(120deg,#0A74E0_0%,#13263B_75%)] p-3.5">
        <p className="text-[16px] font-extrabold tracking-[-0.02em] text-white">Night Owls RC</p>
        <p className="text-[10.5px] font-semibold text-white/75">38 members · Season 4</p>
        <span className="absolute bottom-3 left-3.5">
          <Pill tone="active">Club race · Sat 07:00</Pill>
        </span>
      </div>
      <div className="mx-4 mt-3 rounded-[20px] bg-surface p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-text">Standings · City</p>
        <ul className="mt-2 grid gap-1.5">
          {standings.map((s) => (
            <li key={s.n} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[12px] font-bold ${s.you ? 'bg-primary-soft text-on-primary-soft' : 'text-ink'}`}>
              <span className="w-3 font-display font-black italic">{s.n}</span>
              <span className="flex-1">{s.name}</span>
              <span className="tabular">{s.v}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mx-4 mt-3 grid gap-2 rounded-[20px] bg-surface p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-subtle">Chat</p>
        <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-surface-alt px-3 py-2 text-[11px] font-semibold text-ink">
          <span className="block text-[9.5px] font-bold text-muted">Mara</span>Canal loop at 6? Bring the new folks.
        </p>
        <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary-fill px-3 py-2 text-[11px] font-semibold text-white">
          In. Let’s take the bridge back.
        </p>
      </div>
      <TabBar active="clubs" />
    </>
  );
}

export function AppScreen({ id }: { id: ScreenId }) {
  switch (id) {
    case 'map':
      return <MapScreen />;
    case 'record':
      return <RecordScreen />;
    case 'summary':
      return <SummaryScreen />;
    case 'progress':
      return <ProgressScreen />;
    case 'clubs':
      return <ClubsScreen />;
  }
}
