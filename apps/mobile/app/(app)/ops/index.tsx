import { router, Stack } from 'expo-router';
import { EmptyState, ListGroup, Row, Screen, Section, Txt } from '@/components/ui';
import { useSession } from '@/state/session';

/** Operator tools (PRD §16). Every action is authorized server-side by staff role and audited. */
export default function OpsHome() {
  const { roles } = useSession();
  const has = (r: string) => roles.includes(r) || roles.includes('admin');
  if (!roles.length) return <Screen><EmptyState title="Staff only" /></Screen>;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Operator tools' }} />
      <Txt variant="caption">Signed in with roles: {roles.join(', ')}. Every decision is recorded with its reason.</Txt>
      <Section title="Queues" icon="shield">
        <ListGroup>
        {has('moderator') ? <Row icon="flag" title="Moderation queue" subtitle="Reports, content and account decisions, content appeals" onPress={() => router.push('/ops/moderation')} /> : null}
        {has('route_reviewer') ? <Row icon="route" title="Route proposals" subtitle="Approve, decline, suspend routes" onPress={() => router.push('/ops/routes')} /> : null}
        {has('integrity_reviewer') ? <Row icon="target" title="Integrity cases" subtitle="Holds, invalidations and competitive appeals" onPress={() => router.push('/ops/integrity')} /> : null}
        </ListGroup>
      </Section>
      {has('territory_operator') || has('admin') ? (
        <Section title="System" icon="settings">
          <ListGroup>
            <Row icon="settings" title="Switches, regions, exclusions and jobs" onPress={() => router.push('/ops/system')} />
            <Row icon="calendar" title="Seasons and events" subtitle="Race season dates, automatic length, events" onPress={() => router.push('/ops/seasons')} />
          </ListGroup>
        </Section>
      ) : null}
    </Screen>
  );
}
