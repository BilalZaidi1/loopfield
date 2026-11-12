import 'server-only';
import { cache } from 'react';
import { rpc } from '@/lib/rpc';
import type { ConfigRow, Metrics, Overview, Rbac, RulesPayload } from '@/lib/types';

/** Deduplicated per request: the layout's nav counts and the overview page share one call. */
export const getOverview = cache(() => rpc<Overview>('ops_overview'));
export const getConfig = cache(() => rpc<ConfigRow[]>('ops_config'));
export const getRbac = cache(() => rpc<Rbac>('ops_rbac'));
export const getRules = cache(() => rpc<RulesPayload>('ops_rules'));
export const getPreferences = cache(() => rpc<Record<string, unknown>>('ops_preferences'));
export const getMetrics = cache((from: string, to: string) => rpc<Metrics>('ops_metrics', { p_from: from, p_to: to }));
