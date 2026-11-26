import type { TrainingDay } from '@loopfield/core';
import { fmtDay } from '@/lib/format';

/** Words for the training screens (R2), kept apart from the screens so they can be tested. */
export const NOT_MEDICAL = 'For training, not medical advice.';

/** One row per week (Monday first): effort that week and the loads at its end. */
export function weekRows(days: readonly TrainingDay[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    const end = week[week.length - 1]!;
    rows.push([fmtDay(week[0]!.day), String(week.reduce((s, d) => s + d.effort, 0)), String(Math.round(end.long)), String(Math.round(end.short)), String(Math.round(end.balance))]);
  }
  return rows.reverse();
}

export function balanceWord(balance: number): string {
  if (balance > 5) return 'Fresher than usual';
  if (balance < -5) return 'More tired than usual';
  return 'About usual';
}

