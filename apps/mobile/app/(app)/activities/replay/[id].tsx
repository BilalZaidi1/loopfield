import { Stack, useLocalSearchParams } from 'expo-router';
import { useFeature } from '@/lib/appConfig';
import { EmptyState, ErrorState, LoadingState, Screen } from '@/components/ui';
import { PausedNote } from '@/components/Notices';
import { useReplayPlan } from '@/features/replay/plan';
import { ReplayView } from '@/features/replay/ReplayView';
import { useActivityDetail } from '@/features/results/useActivity';
import { useUnits } from '@/state/session';
import { useReducedMotion } from '@/theme/motion';

/** Replay (R4): the runner's own run, flown over in 3D in about 20 seconds. Only the runner can open it. */
export default function ReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const on = useFeature('replay_enabled');
  const units = useUnits();
  const reduced = useReducedMotion();
  const detail = useActivityDetail(id);
  const a = detail.data?.activity;
  const plan = useReplayPlan(a, units);
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Replay' }} />
      {!on ? <PausedNote feature="replay_enabled" /> : detail.isLoading ? <LoadingState variant="cards" /> : detail.error ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : !a || !plan ? (
        <EmptyState icon="play" title="Nothing to replay yet" body="The replay appears once the server has processed this run's route." />
      ) : (
        <ReplayView key={a.id} plan={plan} runM={a.distance_m ?? plan.lengthM} units={units} reduced={Boolean(reduced)} />
      )}
    </Screen>
  );
}
