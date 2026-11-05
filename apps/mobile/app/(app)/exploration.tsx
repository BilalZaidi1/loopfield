import { useMemo } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { cellArea } from 'h3-js';
import { fmtArea, fmtDate, splitValue } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { BigNumber, Card, EmptyState, ErrorState, LoadingState, Screen, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { MapCanvas } from '@/features/map/MapCanvas';
import { useSession, useUnits } from '@/state/session';
import { bigintCellToH3, boundsOf, cellCenter, plainCellsToFeatures } from '@/territory/h3';
import { spacing, useTheme } from '@/theme/tokens';

/** S18 Private exploration — personal explored map and progress, independent of land losses. */
export default function Exploration() {
  const t = useTheme();
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
  const fc = useMemo(() => plainCellsToFeatures((q.data?.cells ?? []).map((c) => c.h3), t.territory.exploration), [q.data, t.territory.exploration]);
  const area = useMemo(() => (q.data?.cells ?? []).reduce((t, c) => t + cellArea(c.h3, 'm2'), 0), [q.data]);
  const fit = useMemo(() => boundsOf((q.data?.cells ?? []).slice(0, 500).map((c) => cellCenter(c.h3)).filter((x): x is [number, number] => Boolean(x))), [q.data]);
  const firstVisit = q.data?.cells.reduce<string | null>((m, c) => (!m || c.first_visited_at < m ? c.first_visited_at : m), null);
  return (
    <Screen>
      <Stack.Screen options={{ title: 'My exploration' }} />
      <Txt color="textMuted">Every place you have run, including private runs. Only you can see this, and it never shrinks when you lose land.</Txt>
      {q.isLoading ? <LoadingState variant="cards" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.total ? (
        <EmptyState icon="compass" title="Nothing explored yet" body="Explored ground appears after your runs are uploaded and processed." action={{ label: 'Start a run', onPress: () => router.push('/record') }} />
      ) : (
        <>
          <Card tone="blue">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name="compass" color="#FFFFFF" size={22} />
              <Txt variant="heading" style={{ flex: 1 }}>Ground you have covered</Txt>
              <Icon name="lock" color="#FFFFFF" size={18} />
            </View>
            <BigNumber value={splitValue(fmtArea(area, units)).value} unit={splitValue(fmtArea(area, units)).unit} size={64} />
            <Txt color="textMuted">{`${q.data.total} cells explored${firstVisit ? ` since ${fmtDate(firstVisit)}` : ''}`}</Txt>
            {q.data.total > q.data.cells.length ? <Txt variant="caption">{`Area shown for the ${q.data.cells.length} most recent cells.`}</Txt> : null}
          </Card>
          <MapCanvas height={360} fit={fit} layers={{ overlayCells: fc }} accessibilityLabel={`Map of ${q.data.total} explored cells.`} />
        </>
      )}
    </Screen>
  );
}
