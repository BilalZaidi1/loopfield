import type { SupportStatus } from '@/lib/types';

export const STATUS_BADGE: Record<SupportStatus, { label: string; tone: 'info' | 'warning' | 'success' | 'muted' }> = {
  open: { label: 'Open', tone: 'info' },
  pending: { label: 'Waiting on runner', tone: 'warning' },
  solved: { label: 'Solved', tone: 'success' },
  closed: { label: 'Closed', tone: 'muted' }
};
