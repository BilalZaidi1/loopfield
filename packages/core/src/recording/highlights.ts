/**
 * Run highlights (running features, stage 2): up to three short lines about what was special in a run,
 * written by fixed rules on the phone. No AI and no server: every fact comes from data the phone already
 * has (the run, the runner's history including imported runs, goals, land results and, later, shoes).
 *
 * Each rule returns a line with its kind and priority, or nothing. Cool-downs keep the same kind of line from
 * appearing run after run unless the fact is new. A rule stays quiet whenever it can't be sure: a claim such
 * as "your fastest 5 km since August" is made only when the history loaded covers the comparison.
 */
export type HighlightKind = 'longest' | 'fastest' | 'faster_second_half' | 'land' | 'goal' | 'streak' | 'effort' | 'shoes';

export interface Highlight {
  kind: HighlightKind;
  priority: number;
  text: string;
  /** False for lines that must never leave the phone (the effort line). */
  shareable: boolean;
}

export interface HighlightRun {
  id: string;
  start: number;
  distanceM: number;
  durationMs: number;
  /** Fastest 5 km in a row from the run's splits (s), when known. */
  best5kSeconds: number | null;
  /** Time for the first and second half of the distance (s), when known. */
  halves: { first: number; second: number } | null;
  imported: boolean;
}

export interface HighlightMemory {
  /** Per kind: when a line of that kind was last shown, and the fact it stated. */
  [kind: string]: { at: number; fact: string } | undefined;
}

export interface HighlightContext {
  run: HighlightRun;
  /** The runner's other runs, imported ones included. */
  history: readonly HighlightRun[];
  /** The earliest time the history covers; claims never reach further back. */
  historyFrom: number;
  now: number;
  offsetMin: number;
  units: 'metric' | 'imperial';
  goals: { weeklyRuns: number | null; weeklyDistanceM: number | null };
  land: { gained: number; kept: number; taken: number } | null;
  effortWord: 'lighter' | 'usual' | 'harder' | null;
  shoes?: { name: string; distanceM: number } | null;
  memory: HighlightMemory;
}

export const HIGHLIGHT_RULES = {
  maxLines: 3,
  /** A faster second half needs a run of at least this length and this many seconds' difference. */
  negativeSplitMinM: 3000,
  negativeSplitMinS: 10,
  /** The same kind is not repeated within this many days unless its fact is new. */
  coolDownDays: 3,
  /** "Fastest since …" needs the faster run to be at least this many days back to be worth saying. */
  fastestMinDays: 14,
  /** Imported runs without splits might have been faster when their average is within this margin. */
  importedMargin: 1.1,
  streakMinRuns: 3,
  streakMinWeeks: 2
} as const;

const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ORDINAL = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const COUNT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

const local = (t: number, offsetMin: number) => new Date(t + offsetMin * 60_000);
const monthKey = (t: number, o: number) => local(t, o).toISOString().slice(0, 7);
function weekKey(t: number, o: number): string {
  const d = local(t, o);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}

function distanceText(m: number, units: 'metric' | 'imperial'): string {
  return units === 'imperial' ? `${(m / 1609.344).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`;
}

function timeText(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const countWord = (n: number) => (n <= 10 ? COUNT[n]! : String(n));

/** True when a line of this kind was shown within the cool-down. */
function coolingDown(ctx: HighlightContext, kind: HighlightKind, days: number = HIGHLIGHT_RULES.coolDownDays): boolean {
  const last = ctx.memory[kind];
  return Boolean(last && ctx.now - last.at < days * DAY);
}

type Rule = (ctx: HighlightContext) => (Highlight & { fact: string }) | null;

const longest: Rule = (ctx) => {
  const { run, history, offsetMin } = ctx;
  const month = monthKey(run.start, offsetMin);
  const monthStart = Date.parse(`${month}-01T00:00:00Z`) - offsetMin * 60_000;
  if (ctx.historyFrom > monthStart) return null;
  const others = history.filter((r) => r.id !== run.id && monthKey(r.start, offsetMin) === month && r.start <= run.start);
  if (!others.length || run.distanceM < 1000 || others.some((r) => r.distanceM >= run.distanceM)) return null;
  return { kind: 'longest', priority: 90, shareable: true, fact: `${month}:${Math.round(run.distanceM)}`, text: `Your longest run this month: ${distanceText(run.distanceM, ctx.units)}.` };
};

const fastest: Rule = (ctx) => {
  const { run } = ctx;
  if (run.best5kSeconds == null) return null;
  const mine = run.best5kSeconds;
  const earlier = ctx.history.filter((r) => r.id !== run.id && r.start < run.start && r.distanceM >= 5000);
  // The most recent run that was faster, or might have been (an imported run without splits close to it).
  let since: number | null = null;
  for (const r of earlier) {
    const faster = r.best5kSeconds != null ? r.best5kSeconds < mine : r.imported && (r.durationMs / 1000) * (5000 / r.distanceM) < mine * HIGHLIGHT_RULES.importedMargin;
    if (faster && (since == null || r.start > since)) since = r.start;
  }
  if (since == null) {
    // Faster than everything loaded: say how far back that reaches, in whole months.
    const months = Math.floor((run.start - ctx.historyFrom) / (30 * DAY));
    if (months < 1 || !earlier.length) return null;
    return { kind: 'fastest', priority: 85, shareable: true, fact: `all:${mine}`, text: `Your fastest 5 km in ${months === 1 ? 'a month' : `${countWord(months)} months`}: ${timeText(mine)}.` };
  }
  if (run.start - since < HIGHLIGHT_RULES.fastestMinDays * DAY) return null;
  const when = local(since, ctx.offsetMin);
  const sameYear = when.getUTCFullYear() === local(run.start, ctx.offsetMin).getUTCFullYear();
  const label = `${MONTHS[when.getUTCMonth()]}${sameYear ? '' : ` ${when.getUTCFullYear()}`}`;
  return { kind: 'fastest', priority: 85, shareable: true, fact: `${since}:${mine}`, text: `Your fastest 5 km since ${label}: ${timeText(mine)}.` };
};

const fasterSecondHalf: Rule = (ctx) => {
  const h = ctx.run.halves;
  if (!h || ctx.run.distanceM < HIGHLIGHT_RULES.negativeSplitMinM) return null;
  const diff = Math.round(h.first - h.second);
  if (diff < HIGHLIGHT_RULES.negativeSplitMinS) return null;
  const fact = String(diff);
  // Not run after run, unless the second half beat the first by more than last time.
  if (coolingDown(ctx, 'faster_second_half') && !(diff > Number(ctx.memory.faster_second_half?.fact ?? Infinity))) return null;
  return { kind: 'faster_second_half', priority: 50, shareable: true, fact, text: `Second half ${diff >= 120 ? `${Math.round(diff / 60)} minutes` : `${diff} seconds`} faster than the first.` };
};

const land: Rule = (ctx) => {
  const l = ctx.land;
  if (!l) return null;
  if (l.taken > 0) return { kind: 'land', priority: 80, shareable: true, fact: `taken:${l.taken}`, text: `You took ${l.taken} ${l.taken === 1 ? 'cell' : 'cells'} from other runners.` };
  if (l.gained > 0) return { kind: 'land', priority: 78, shareable: true, fact: `gained:${l.gained}`, text: `You claimed ${l.gained} new ${l.gained === 1 ? 'cell' : 'cells'}.` };
  if (l.kept > 0) return { kind: 'land', priority: 60, shareable: true, fact: `kept:${l.kept}`, text: `You held on to ${l.kept} ${l.kept === 1 ? 'cell' : 'cells'}.` };
  return null;
};

function weekRuns(ctx: HighlightContext, week: string): HighlightRun[] {
  return [ctx.run, ...ctx.history.filter((r) => r.id !== ctx.run.id)].filter((r) => weekKey(r.start, ctx.offsetMin) === week && r.start <= ctx.run.start);
}

const goal: Rule = (ctx) => {
  const target = ctx.goals.weeklyRuns;
  const week = weekKey(ctx.run.start, ctx.offsetMin);
  const weekStart = Date.parse(`${week}T00:00:00Z`) - ctx.offsetMin * 60_000;
  if (!target || target < 2 || ctx.historyFrom > weekStart) return null;
  const n = weekRuns(ctx, week).length;
  // At most one goal line a day.
  const last = ctx.memory.goal;
  if (last && local(last.at, ctx.offsetMin).toISOString().slice(0, 10) === local(ctx.now, ctx.offsetMin).toISOString().slice(0, 10)) return null;
  const nth = n <= 10 ? ORDINAL[n]! : `Run number ${n}`;
  if (n === target) return { kind: 'goal', priority: 65, shareable: true, fact: `${week}:${n}`, text: `${nth} run this week: you reached your weekly goal.` };
  if (n === target - 1) return { kind: 'goal', priority: 55, shareable: true, fact: `${week}:${n}`, text: `${nth} run this week. One more reaches your weekly goal.` };
  return null;
};

const streak: Rule = (ctx) => {
  const week = weekKey(ctx.run.start, ctx.offsetMin);
  const thisWeek = weekRuns(ctx, week).length;
  if (thisWeek !== HIGHLIGHT_RULES.streakMinRuns) return null;
  let weeks = 1;
  for (let i = 1; i < 60; i++) {
    const t = ctx.run.start - i * 7 * DAY;
    if (t < ctx.historyFrom) return null; // can't be sure how long the streak is
    const k = weekKey(t, ctx.offsetMin);
    const count = ctx.history.filter((r) => weekKey(r.start, ctx.offsetMin) === k).length;
    if (count < HIGHLIGHT_RULES.streakMinRuns) break;
    weeks++;
  }
  if (weeks < HIGHLIGHT_RULES.streakMinWeeks) return null;
  return { kind: 'streak', priority: 70, shareable: true, fact: `${week}:${weeks}`, text: `${cap(countWord(weeks))} weeks in a row with at least ${countWord(HIGHLIGHT_RULES.streakMinRuns)} runs.` };
};

const effort: Rule = (ctx) => {
  if (ctx.effortWord !== 'harder') return null;
  if (coolingDown(ctx, 'effort')) return null;
  return { kind: 'effort', priority: 40, shareable: false, fact: 'harder', text: 'Harder than usual for you.' };
};

const shoes: Rule = (ctx) => {
  const s = ctx.shoes;
  if (!s || !s.name.trim()) return null;
  const hundreds = Math.floor(s.distanceM / 100_000);
  if (hundreds < 1) return null;
  const fact = `${s.name}:${hundreds}`;
  if (ctx.memory.shoes?.fact === fact) return null;
  return { kind: 'shoes', priority: 30, shareable: true, fact, text: `Your ${s.name.trim()} shoes are now at ${distanceText(s.distanceM, ctx.units).replace('.0 ', ' ')}.` };
};

export const HIGHLIGHT_RULE_LIST: readonly Rule[] = [longest, fastest, land, streak, goal, fasterSecondHalf, effort, shoes];

/** The run's highlights (at most three, highest priority first) and the memory to keep for the next run. */
export function runHighlights(ctx: HighlightContext): { lines: Highlight[]; memory: HighlightMemory } {
  const found = HIGHLIGHT_RULE_LIST.map((rule) => rule(ctx)).filter((h): h is Highlight & { fact: string } => h != null);
  const top = found.sort((a, b) => b.priority - a.priority).slice(0, HIGHLIGHT_RULES.maxLines);
  const memory: HighlightMemory = { ...ctx.memory };
  for (const h of top) memory[h.kind] = { at: ctx.now, fact: h.fact };
  return { lines: top.map(({ kind, priority, text, shareable }) => ({ kind, priority, text, shareable })), memory };
}

/** Fastest 5 km in a row from 1 km splits (gaps excluded), in seconds. */
export function best5kFromSplits(splits: readonly { distanceM: number; elapsedMs: number; containsGap?: boolean }[] | null | undefined): number | null {
  if (!splits || splits.length < 5) return null;
  let best: number | null = null;
  for (let i = 0; i + 5 <= splits.length; i++) {
    const w = splits.slice(i, i + 5);
    if (w.some((s) => s.containsGap || Math.abs(s.distanceM - 1000) > 1)) continue;
    const t = w.reduce((sum, s) => sum + s.elapsedMs, 0) / 1000;
    if (best == null || t < best) best = t;
  }
  return best == null ? null : Math.round(best);
}

/** Time for each half of the distance, from the splits (null when a gap falls in the run). */
export function halvesFromSplits(splits: readonly { distanceM: number; elapsedMs: number; containsGap?: boolean }[] | null | undefined): { first: number; second: number } | null {
  if (!splits || splits.length < 2 || splits.some((s) => s.containsGap)) return null;
  const total = splits.reduce((sum, s) => sum + s.distanceM, 0);
  const totalMs = splits.reduce((sum, s) => sum + s.elapsedMs, 0);
  if (total <= 0) return null;
  const half = total / 2;
  let d = 0;
  let t = 0;
  for (const s of splits) {
    if (d + s.distanceM >= half) {
      const firstMs = t + (s.elapsedMs * (half - d)) / s.distanceM;
      return { first: Math.round(firstMs / 1000), second: Math.round((totalMs - firstMs) / 1000) };
    }
    d += s.distanceM;
    t += s.elapsedMs;
  }
  return null;
}
