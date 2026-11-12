import type { Metadata } from 'next';
import { requireStaff } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { viewerTimeZone } from '@/lib/tz';
import { dateTime, relativeTime } from '@/lib/format';
import { formatValue } from '@/lib/config-validate';
import type { ConfigHistoryRow } from '@/lib/types';
import { ButtonLink, Card, EmptyState, PageHeader, Table } from '@/components/ui';

export const metadata: Metadata = { title: 'Setting history' };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  await requireStaff();
  const { key } = await searchParams;
  const [rows, tz] = await Promise.all([rpc<ConfigHistoryRow[]>('ops_config_history', { p_key: key ?? null, p_limit: 200 }), viewerTimeZone()]);
  return (
    <>
      <PageHeader
        title={key ? `History · ${key}` : 'Setting history'}
        description="Every change made from the console or the app's operator screen, newest first."
        actions={<ButtonLink href="/settings" variant="ghost">Back to App control</ButtonLink>}
      />
      <Card>
        {rows.length ? (
          <Table head={['When', 'Setting', 'Change', 'By', 'Reason']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap" title={dateTime(r.created_at, tz ?? 'UTC')}>{relativeTime(r.created_at)}</td>
                <td><code className="font-mono text-[13px]">{r.key}</code></td>
                <td className="min-w-[200px]">
                  <span className="text-muted line-through decoration-1">{formatValue(r.old_value)}</span> → <b>{formatValue(r.new_value)}</b>
                </td>
                <td className="whitespace-nowrap">@{r.actor_handle ?? 'unknown'}</td>
                <td className="text-muted">{r.reason}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title="No changes yet" body="Changes made from now on are listed here with who made them and why." />
        )}
      </Card>
    </>
  );
}
