import { useState } from 'react';
import { Alert } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Button, Card, Row, Screen, Section, Segmented, TextField, Toggle, Txt } from '@/components/ui';
import { useCompetition } from '@/state/competition';

const SWITCHES = [
  { key: 'territory_capture_enabled', label: 'Land capture' },
  { key: 'speed_titles_enabled', label: 'Speed titles' },
  { key: 'public_publication_enabled', label: 'Publication to maps and rankings' },
  { key: 'photo_uploads_enabled', label: 'Photo uploads' },
  { key: 'messaging_enabled', label: 'Direct messages' }
];

/** Kill switches, region exclusion review, exclusion zones, season replay, dead jobs and role grants. */
export default function OpsSystem() {
  const { competition, season } = useCompetition();
  const config = useQuery({ queryKey: ['ops_config'], queryFn: async () => (await supabase().from('app_config').select('key, value')).data ?? [] });
  const regions = useQuery({ queryKey: ['ops_regions'], queryFn: async () => (await supabase().from('regions').select('id, name, exclusion_review_status, exclusion_set_version')).data ?? [] });
  const dead = useQuery({ queryKey: ['ops_dead_jobs'], queryFn: () => rpc<{ id: number; queue: string; kind: string; attempts: number; last_error: string | null; updated_at: string }[]>('ops_dead_jobs', { p_limit: 50 }) });
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: () => { void config.refetch(); void regions.refetch(); void dead.refetch(); }, onError: (e) => Alert.alert('Not applied', friendlyError(e)) });
  const [geojson, setGeojson] = useState('');
  const [kind, setKind] = useState<'restricted' | 'sensitive' | 'dangerous' | 'private_property' | 'other'>('restricted');
  const [reason, setReason] = useState('');
  const [roleUser, setRoleUser] = useState('');
  const [role, setRole] = useState<'moderator' | 'route_reviewer' | 'integrity_reviewer' | 'territory_operator' | 'support'>('moderator');
  const value = (k: string) => config.data?.find((r) => r.key === k)?.value;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'System' }} />
      <Section title="Kill switches">
        <Txt variant="caption">Turning a switch off pauses that feature everywhere; private recording always continues.</Txt>
        {SWITCHES.map((s) => <Toggle key={s.key} label={s.label} value={value(s.key) === true} onChange={(v) => run.mutate(() => rpc('ops_set_switch', { p_key: s.key, p_value: v }))} />)}
      </Section>
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
      <Section title={`Dead-lettered jobs (${dead.data?.length ?? 0})`}>
        {dead.data?.map((j) => <Row key={j.id} title={`${j.queue}/${j.kind} · ${j.attempts} attempts`} subtitle={`${j.last_error ?? ''} · ${fmtRelative(j.updated_at)}`} right={<Button variant="ghost" label="Retry" onPress={() => run.mutate(() => rpc('ops_retry_job', { p_job: j.id }))} />} />)}
      </Section>
      <Section title="Grant a staff role (admin)">
        <TextField label="User id" value={roleUser} onChangeText={setRoleUser} autoCapitalize="none" />
        <Segmented label="Role" value={role} onChange={setRole} options={[{ value: 'moderator', label: 'Moderator' }, { value: 'route_reviewer', label: 'Routes' }, { value: 'integrity_reviewer', label: 'Integrity' }, { value: 'territory_operator', label: 'Territory' }, { value: 'support', label: 'Support' }]} />
        <Button variant="secondary" label="Grant" disabled={roleUser.length < 36} onPress={() => run.mutate(() => rpc('ops_grant_role', { p_user: roleUser.trim(), p_role: role, p_grant: true }))} />
        <Button variant="ghost" label="Revoke" disabled={roleUser.length < 36} onPress={() => run.mutate(() => rpc('ops_grant_role', { p_user: roleUser.trim(), p_role: role, p_grant: false }))} />
      </Section>
    </Screen>
  );
}
