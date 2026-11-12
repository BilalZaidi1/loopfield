import { useLocalSearchParams } from 'expo-router';
import { MetricView } from '@/features/health/MetricView';
import type { MetricId } from '@/features/health/metrics';
import { useHealthDerived } from '@/health/useHealth';

/** S38 Metric detail: one metric from the phone's health data, drawn in the form that suits it. */
export default function MetricDetail() {
  const { type } = useLocalSearchParams<{ type: MetricId }>();
  const d = useHealthDerived();
  return <MetricView type={type} d={d} />;
}
