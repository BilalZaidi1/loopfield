import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { APP_CONFIG_QUERY_KEY } from '@/lib/appConfig';
import { fmtRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Button, Card, Chip, ErrorState, LoadingState, Row, Screen, Section, Segmented, TextField, Txt } from '@/components/ui';
import { useReasonPrompt } from '@/features/ops/ReasonPrompt';
import { StaffGate } from '@/features/ops/StaffGate';
import { SwitchList } from '@/features/ops/SwitchList';
import { switchRows, type ConfigRow } from '@/features/ops/tools';
import { useCompetition } from '@/state/competition';
import { useSession } from '@/state/session';
import { spacing } from '@/theme/tokens';

interface RbacRole {
  key: string;
  label: string;
  permissions: string[];
}

/** Kill switches, region exclusion review, exclusion zones, season replay, failed jobs and staff roles, each by permission. */
export default function OpsSystemScreen() {
  return (
    <StaffGate need={['territory', 'config', 'jobs', 'staff']} title="System">
      <OpsSystem />
    </StaffGate>
  );
}

function OpsSystem() {
  const { can } = useSession();
  const qc = useQueryClient();
  const prompt = useReasonPrompt();
  const { competition, season } = useCompetition();
  const territory = can('territory');
  const config = useQuery({ queryKey: ['ops_config'], queryFn: () => rpc<ConfigRow[]>('ops_config') });
  const regions = useQuery({ queryKey: ['ops_regions'], enabled: territory, queryFn: async () => (await supabase().from('regions').select('id, name, exclusion_review_status, exclusion_set_version')).data ?? [] });
  const dead = useQuery({ queryKey: ['ops_dead_jobs'], enabled: can('jobs'), queryFn: () => rpc<{ id: number; queue: string; kind: string; attempts: number; last_error: string | null; updated_at: string }[]>('ops_dead_jobs', { p_limit: 50 }) });
  const rbac = useQuery({ queryKey: ['ops_rbac'], enabled: can('staff'), queryFn: () => rpc<{ roles: RbacRole[]; can_grant: boolean; my_permissions: string[] }>('ops_rbac') });
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void config.refetch();
      void regions.refetch();
      void dead.refetch();
      // The app's own settings follow at once (comment box, record modes and so on).
      void qc.invalidateQueries({ queryKey: APP_CONFIG_QUERY_KEY });
    },
    onError: (e) => Alert.alert('Not applied', friendlyError(e))
  });
  const setConfig = (r: ConfigRow, value: unknown, title: string) =>
    prompt.ask(title, (reason) => run.mutate(() => rpc('ops_set_config', { p_key: r.key, p_value: value, p_reason: reason })));
  const [geojson, setGeojson] = useState('');
  const [kind, setKind] = useState<'restricted' | 'sensitive' | 'dangerous' | 'private_property' | 'other'>('restricted');
  const [reason, setReason] = useState('');
  const [roleUser, setRoleUser] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const switches = switchRows(config.data ?? []);
  const myPerms = rbac.data?.my_permissions ?? [];
  // Roles you may grant: never one with permissions you do not hold (admins hold them all).
  const grantable = (rbac.data?.roles ?? []).filter((r) => r.permissions.every((x) => myPerms.includes(x)));

  return (
    <Screen onRefresh={() => void config.refetch()} refreshing={config.isRefetching}>
      <Stack.Screen options={{ title: 'System' }} />
      {prompt.element}
      <Section title="Kill switches" icon="ban">
        <Txt variant="caption">Turning a switch off pauses that feature everywhere within minutes; private recording always continues. Every change needs a reason and is recorded.</Txt>
        {config.isLoading ? <LoadingState /> : config.error ? <ErrorState error={config.error} onRetry={() => void config.refetch()} /> : (
          <SwitchList rows={switches} busy={run.isPending} onSet={(r, value, title) => setConfig(r, value, title)} />
        )}
        {switches.some((r) => !r.can_edit) ? <Txt variant="caption">Switches you cannot change are shown for reference; your role decides which ones you can flip.</Txt> : null}
      </Section>
      {territory ? (
        <>
          <Section title="Regions">
            {regions.data?.map((r) => (
              <Card key={r.id as string}>
                <Txt variant="label">{String(r.name)} · exclusions {String(r.exclusion_review_status)}{r.exclusion_set_version ? ` (${String(r.exclusion_set_version)})` : ''}</Txt>
                <Txt variant="caption">Land is never awarded while exclusion data is unreviewed (fails closed).</Txt>
                <Button variant="secondary" label={r.exclusion_review_status === 'reviewed' ? 'Mark unreviewed' : 'Mark reviewed'} onPress={() => run.mutate(() => rpc('ops_set_region_review', { p_region: r.id, p_status: r.exclusion_review_status === 'reviewed' ? 'unavailable' : 'reviewed', p_set_version: `ops-${new Date().toISOString().slice(0, 10)}` }))} />
              </Card>
            ))}
          </Section>
          <Section title="Add exclusion zone">
            <TextField label="Polygon GeoJSON" value={geojson} onChangeText={setGeojson} multiline autoCapitalize="none" placeholder='{"type":"Polygon","coordinates":[[[lng,lat],...]]}' />
            <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: 'restricted', label: 'Restricted' }, { value: 'sensitive', label: 'Sensitive' }, { value: 'dangerous', label: 'Dangerous' }, { value: 'private_property', label: 'Private' }, { value: 'other', label: 'Other' }]} />
            <TextField label="Reason" value={reason} onChangeText={setReason} />
            <Button
              variant="secondary"
              label="Add and apply now"
              disabled={!competition || !geojson || reason.trim().length < 5}
              onPress={() => {
                let parsed: unknown;
                try {
                  parsed = JSON.parse(geojson);
                } catch {
                  return Alert.alert('Invalid GeoJSON');
                }
                run.mutate(() => rpc('ops_add_exclusion', { p_region: competition!.region_id, p_geojson: parsed, p_kind: kind, p_reason: reason, p_apply_now: true }));
              }}
            />
          </Section>
          <Section title="Season replay">
            <Txt variant="caption">Rebuilds cell control for the current season from the claim ledger (deterministic). Use after corrections.</Txt>
            <Button variant="secondary" label="Replay current season" disabled={!competition || !season} onPress={() => run.mutate(async () => { const n = await rpc<number>('ops_replay_season', { p_competition: competition!.id, p_season: season!.id }); Alert.alert('Replayed', `${n} cells rebuilt.`); })} />
          </Section>
        </>
      ) : null}
      {can('jobs') ? (
        <Section title={`Failed jobs (${dead.data?.length ?? 0})`}>
          {dead.data?.map((j) => <Row key={j.id} title={`${j.queue}/${j.kind} · ${j.attempts} attempts`} subtitle={`${j.last_error ?? ''} · ${fmtRelative(j.updated_at)}`} right={<Button variant="ghost" label="Retry" onPress={() => run.mutate(() => rpc('ops_retry_job', { p_job: j.id }))} />} />)}
        </Section>
      ) : null}
      {can('staff') && rbac.data?.can_grant ? (
        <Section title="Grant a staff role">
          <TextField label="User id" value={roleUser} onChangeText={setRoleUser} autoCapitalize="none" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Role">
            {grantable.map((r) => <Chip key={r.key} label={r.label} selected={role === r.key} onPress={() => setRole(r.key)} />)}
          </View>
          <Button variant="secondary" label="Grant" disabled={roleUser.trim().length < 36 || !role} onPress={() => run.mutate(() => rpc('ops_grant_role', { p_user: roleUser.trim(), p_role: role, p_grant: true }))} />
          <Button variant="ghost" label="Revoke" disabled={roleUser.trim().length < 36 || !role} onPress={() => run.mutate(() => rpc('ops_grant_role', { p_user: roleUser.trim(), p_role: role, p_grant: false }))} />
        </Section>
      ) : null}
    </Screen>
  );
}
