import { router, Stack } from 'expo-router';
import { EmptyState, ListGroup, Row, Screen, Section, Txt } from '@/components/ui';
import { StaffGate } from '@/features/ops/StaffGate';
import { toolsFor } from '@/features/ops/tools';
import { useSession } from '@/state/session';

/** Operator tools (PRD §16). Every action is authorized server-side by permission and audited. */
export default function OpsHome() {
  return (
    <StaffGate need="any" title="Operator tools">
      <OpsMenu />
    </StaffGate>
  );
}

function OpsMenu() {
  const { staff } = useSession();
  const tools = toolsFor(staff.permissions);
  const queues = tools.filter((t) => t.group === 'queues');
  const system = tools.filter((t) => t.group === 'system');
  const row = (t: (typeof tools)[number]) => <Row key={t.key} icon={t.icon} title={t.title} subtitle={t.subtitle} onPress={() => router.push(t.href)} />;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Operator tools' }} />
      <Txt variant="caption">{`Your roles: ${staff.roleLabels.join(', ') || staff.roles.join(', ')}. Every decision is recorded with its reason. The back office has the full set of tools.`}</Txt>
      {queues.length ? (
        <Section title="Queues" icon="shield">
          <ListGroup>{queues.map(row)}</ListGroup>
        </Section>
      ) : null}
      {system.length ? (
        <Section title="System" icon="settings">
          <ListGroup>{system.map(row)}</ListGroup>
        </Section>
      ) : null}
      {!tools.length ? <EmptyState icon="shield" title="No tools here for your role" body="Your role's tools are in the back office." /> : null}
    </Screen>
  );
}
