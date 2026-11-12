import 'server-only';
import { cache } from 'react';
import { rpc } from '@/lib/rpc';
import type { ConfigRow, Overview } from '@/lib/types';

/** Deduplicated per request: the layout's nav counts and the overview page share one call. */
export const getOverview = cache(() => rpc<Overview>('ops_overview'));
export const getConfig = cache(() => rpc<ConfigRow[]>('ops_config'));
