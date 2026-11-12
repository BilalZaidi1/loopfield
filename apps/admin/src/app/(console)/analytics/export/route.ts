import { requirePermission } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import type { Metrics } from '@/lib/types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Daily metrics as CSV (one row per day, one column per metric). */
export async function GET(req: Request) {
  await requirePermission('analytics');
  const url = new URL(req.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!DAY.test(from) || !DAY.test(to)) return new Response('from and to must be YYYY-MM-DD', { status: 400 });
  const m = await rpc<Metrics>('ops_metrics', { p_from: from, p_to: to });
  const keys = m.catalog.map((c) => c.key);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['day', ...keys].join(','), ...m.days.map((d, i) => [d, ...keys.map((k) => String(m.series[k]?.[i] ?? 0))].map(esc).join(','))];
  return new Response(lines.join('\n') + '\n', {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="loopfield-metrics-${from}-to-${to}.csv"`, 'cache-control': 'no-store' }
  });
}
