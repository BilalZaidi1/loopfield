import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useAppConfig } from '@/lib/appConfig';
import { countryName } from '@/lib/countries';
import { ListGroup, Row, Sheet, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useSession } from '@/state/session';
import { radius, spacing, useTheme } from '@/theme/tokens';

/**
 * Runners out right now (R2): how many runners are out in the runner's city, country and everywhere, counted
 * by the city and country on profiles. No positions and no names; counts under five are never shown. The
 * line refreshes every minute while the screen is open; tapping it opens the three counts.
 */
export interface RunningNowCounts {
  enabled: boolean;
  min_count?: number;
  city?: { name: string; count: number | null } | null;
  country?: { code: string; count: number | null } | null;
  everywhere?: number | null;
  computed_at?: string | null;
}

export const RUNNING_NOW_KEY = ['running_now_counts'] as const;

export function useRunningNow(active: boolean) {
  const { settings } = useAppConfig();
  const { userId } = useSession();
  return useQuery({
    queryKey: RUNNING_NOW_KEY,
    enabled: Boolean(userId) && settings.enabled.running_now_enabled,
    refetchInterval: active ? 60_000 : false,
    staleTime: 30_000,
    queryFn: () => rpc<RunningNowCounts>('running_now_counts')
  });
}

const runners = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'runner' : 'runners'}`;

/** The one line: the city when it has five or more, then the country, then everywhere; nothing when all are under five. */
export function runningNowLine(c: RunningNowCounts | null | undefined): string | null {
  if (!c?.enabled) return null;
  if (c.city?.count != null) return `${c.city.count.toLocaleString()} ${c.city.name} ${c.city.count === 1 ? 'runner' : 'runners'} out right now`;
  if (c.country?.count != null) return `${runners(c.country.count)} out right now in ${countryName(c.country.code) ?? c.country.code}`;
  if (c.everywhere != null) return `${runners(c.everywhere)} out right now`;
  return null;
}

export function RunningNowLine({ style }: { style?: 'map' | 'card' }) {
  const t = useTheme();
  const p = t.palette;
  const focused = useIsFocused();
  const q = useRunningNow(focused);
  const [open, setOpen] = useState(false);
  const line = runningNowLine(q.data);
  const shown = useRef(false);

  useEffect(() => {
    if (line && !shown.current) {
      shown.current = true;
      track('running_now', { action: 'shown' });
    }
  }, [line]);

  if (!line) return null;
  const c = q.data!;
  const count = (n: number | null | undefined) => (n == null ? `Fewer than ${c.min_count ?? 5}` : n.toLocaleString());
  return (
    <>
      <Pressable
        onPress={() => { setOpen(true); track('running_now', { action: 'opened' }); }}
        accessibilityRole="button"
        accessibilityLabel={`${line}. Show the counts for your city, your country and everywhere`}
        style={({ pressed }) => [{
          flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: style === 'map' ? 'flex-start' : 'stretch',
          paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: style === 'map' ? 999 : radius.md,
          backgroundColor: p.surface, opacity: pressed ? 0.85 : 1, borderWidth: style === 'map' ? 0 : 1, borderColor: p.border
        }, style === 'map' ? t.elevation.floating : null]}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.success }} accessibilityElementsHidden />
        <Txt variant="label" style={{ flexShrink: 1 }} numberOfLines={1}>{line}</Txt>
        {style === 'map' ? null : <Icon name="chevron-right" color={p.textSubtle} size={18} />}
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Runners out right now">
        <ListGroup>
          {c.city ? <Row icon="pin" title={c.city.name} value={count(c.city.count)} /> : null}
          {c.country ? <Row icon="flag" title={countryName(c.country.code) ?? c.country.code} value={count(c.country.count)} /> : null}
          <Row icon="globe" title="Everywhere" value={count(c.everywhere)} />
        </ListGroup>
        <Txt variant="caption">{`Counted by the city and country on each runner's profile, never by where they are. No names or positions, and counts under ${c.min_count ?? 5} are not shown. You can leave the counts in Privacy settings.`}</Txt>
      </Sheet>
    </>
  );
}
