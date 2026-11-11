import { View } from 'react-native';
import { router } from 'expo-router';
import { Badge, Card, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { fmtDistance } from '@/lib/format';
import { useUnits } from '@/state/session';
import { radius, spacing, useTheme } from '@/theme/tokens';
import { phaseText, type EventRow } from './api';

/** One event in a list: what it is scored on, where, when, and whether you joined. */
export function EventCard({ event: e }: { event: EventRow }) {
  const t = useTheme();
  const p = t.palette;
  const units = useUnits();
  const tone = e.event_type === 'territory' ? t.blocks.violet : t.blocks.blue;
  const where = e.event_type === 'territory' ? e.region_name ?? 'One region' : e.region_name ?? 'Anywhere';
  const kind = e.event_type === 'territory' ? 'Territory' : e.target_m ? `Distance · goal ${fmtDistance(e.target_m, units, 0)}` : 'Distance';
  return (
    <Card onPress={() => router.push({ pathname: '/events/[id]', params: { id: e.id } })} accessibilityLabel={`${e.name}. ${kind}, ${where}. ${phaseText(e)}. ${e.participants} taking part${e.joined ? '. You joined' : ''}. Open the event`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: tone.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={e.event_type === 'territory' ? 'hexagon' : 'route'} color={tone.fg} size={24} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="headline" numberOfLines={1}>{e.name}</Txt>
          <Txt variant="caption" numberOfLines={1}>{`${kind} · ${e.host_club_name ?? where}`}</Txt>
        </View>
        <Icon name="chevron-right" color={p.textSubtle} size={20} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Badge tone={e.phase === 'live' ? 'success' : e.phase === 'cancelled' ? 'muted' : 'info'} icon={e.phase === 'live' ? 'pulse' : 'calendar'} label={phaseText(e)} />
        {e.team_mode === 'club' ? <Badge tone="violet" icon="clubs" label="Club against club" /> : null}
        <Badge tone="muted" icon="user" label={`${e.participants} taking part`} />
        {e.joined ? <Badge tone="success" icon="check" label="You joined" /> : null}
      </View>
    </Card>
  );
}
