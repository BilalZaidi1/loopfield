import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { cellArea } from 'h3-js';
import { fmtArea, fmtDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Card, EmptyState, ErrorState, LoadingState, Screen, StatTile, Txt } from '@/components/ui';
import { MapCanvas } from '@/features/map/MapCanvas';
import { useSession, useUnits } from '@/state/session';
import { bigintCellToH3, boundsOf, cellCenter, plainCellsToFeatures } from '@/territory/h3';
import { usePalette } from '@/theme/tokens';

/** S18 Private exploration — personal explored map and progress, independent of land losses. */
export default function Exploration() {
  const p = usePalette();
  const units = useUnits();
  const { userId } = useSession();
  const q = useQuery({
    queryKey: ['exploration', userId],
    queryFn: async () => {
      const sb = supabase();
      const [{ data, error }, count] = await Promise.all([
        sb.from('exploration_cells').select('cell::text, first_visited_at, visits').order('last_visited_at', { ascending: false }).limit(5000),
        sb.from('exploration_cells').select('cell', { count: 'exact', head: true })
      ]);
      if (error) throw error;
      const rows = (data ?? []) as unknown as { cell: string; first_visited_at: string; visits: number }[];
      return { cells: rows.map((r) => ({ ...r, h3: bigintCellToH3(r.cell) })), total: count.count ?? rows.length };
    }
  });
  const fc = useMemo(() => plainCellsToFeatures((q.data?.cells ?? []).map((c) => c.h3), p.info), [q.data, p.info]);
  const area = useMemo(() => (q.data?.cells ?? []).reduce((t, c) => t + cellArea(c.h3, 'm2'), 0), [q.data]);
  const fit = useMemo(() => boundsOf((q.data?.cells ?? []).slice(0, 500).map((c) => cellCenter(c.h3)).filter((x): x is [number, number] => Boolean(x))), [q.data]);
  const firstVisit = q.data?.cells.reduce<string | null>((m, c) => (!m || c.first_visited_at < m ? c.first_visited_at : m), null);
  return (
    <Screen>
      <Stack.Screen options={{ title: 'My exploration' }} />
      <Txt color="textMuted">Every place you have run, including private runs. Only you can see this, and it never shrinks when you lose land.</Txt>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.total ? (
        <EmptyState title="Nothing explored yet" body="Explored ground appears after your runs are uploaded and processed." />
      ) : (
        <>
          <MapCanvas height={340} fit={fit} layers={{ overlayCells: fc }} accessibilityLabel={`Map of ${q.data.total} explored cells.`} />
          <Card>
            <StatTile label="Explored cells" value={String(q.data.total)} />
            <StatTile label="Explored area" value={fmtArea(area, units)} note={q.data.total > q.data.cells.length ? `Area shown for the ${q.data.cells.length} most recent cells` : undefined} />
            {firstVisit ? <Txt variant="caption">Exploring since {fmtDate(firstVisit)}</Txt> : null}
          </Card>
        </>
      )}
    </Screen>
  );
}
