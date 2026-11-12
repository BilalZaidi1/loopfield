import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { getConfig, getRules } from '@/lib/data';
import { viewerTimeZone } from '@/lib/tz';
import { relativeTime, dateTime } from '@/lib/format';
import type { ConfigCategory, ConfigRow } from '@/lib/types';
import { Badge, Card, PageHeader, SegmentedLinks } from '@/components/ui';
import { Icon } from '@/components/icons';
import { SettingEditor, type RateLimitDef } from './setting-editor';

export const metadata: Metadata = { title: 'App control' };

const TABS: { value: ConfigCategory; label: string; blurb: string }[] = [
  { value: 'switch', label: 'Kill switches', blurb: 'Enforced by the server the moment you apply them. Private recording is never affected.' },
  { value: 'tunable', label: 'Game tunables', blurb: 'Economy and competition numbers. Changes apply to new activity; settled seasons are not replayed. Loop and route thresholds live in Game rules.' },
  { value: 'sharing', label: 'Sharing', blurb: 'What a shared run shows: the map on share cards, the hidden start and finish, privacy zones and the delay before a route is public.' },
  { value: 'season', label: 'Seasons', blurb: 'Timings copied onto each new season when it is created, so a running season never changes under its players.' },
  { value: 'limits', label: 'Posts & limits', blurb: 'Post and comment limits, the daily digest time and anti-spam limits per runner.' },
  { value: 'release', label: 'Releases', blurb: 'Force or nudge app updates, or put the app behind a maintenance screen.' },
  { value: 'monetization', label: 'Monetization', blurb: 'The pilot is free. Core competition, social, health, privacy and deletion can never be gated.' },
  { value: 'system', label: 'System', blurb: 'Rules status and how strictly operator sessions are checked.' },
  { value: 'other', label: 'Other', blurb: 'Settings not yet in the registry. Admins can edit them as raw JSON of the same type.' }
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireStaff();
  const [{ tab }, rows, tz, rules] = await Promise.all([searchParams, getConfig(), viewerTimeZone(), getRules().catch(() => null)]);
  const available = TABS.filter((t) => rows.some((r) => r.category === t.value));
  const active = available.find((t) => t.value === tab) ?? available[0]!;
  const list = rows.filter((r) => r.category === active.value);

  return (
    <>
      <PageHeader
        title="App control"
        description="Everything the app reads from app_config. Each change needs a reason and is kept in the setting's history and the audit log."
      />
      <SegmentedLinks
        label="Setting groups"
        value={active.value}
        options={available.map((t) => ({ value: t.value, label: t.label, href: `/settings?tab=${t.value}` }))}
      />
      <p className="type-body text-muted -mt-2">{active.blurb}</p>
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {list.map((row) => (
            <SettingRow key={row.key} row={row} tz={tz ?? 'UTC'} rateLimits={rules?.rate_limits} />
          ))}
        </ul>
      </Card>
    </>
  );
}

function SettingRow({ row, tz, rateLimits }: { row: ConfigRow; tz: string; rateLimits?: RateLimitDef[] }) {
  return (
    <li className="px-5 py-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex flex-col gap-1 min-w-0 lg:max-w-[52%]">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="type-body-strong">{row.label}</h3>
          {!row.is_public ? <Badge label="Server only" tone="muted" /> : null}
        </div>
        {row.help || row.description ? <p className="type-caption text-muted">{row.help ?? row.description}</p> : null}
        <p className="type-caption text-muted flex flex-wrap items-center gap-x-2">
          <code className="font-mono text-[12px]">{row.key}</code>
          {row.last_changed_at ? (
            <span title={dateTime(row.last_changed_at, tz)}>
              · changed {relativeTime(row.last_changed_at)} by @{row.last_changed_by ?? 'unknown'}: “{row.last_reason}”
            </span>
          ) : (
            <span>· updated {relativeTime(row.updated_at)}</span>
          )}
          <Link href={`/settings/history?key=${encodeURIComponent(row.key)}`} className="inline-flex items-center gap-1 text-primary">
            <Icon name="history" size={13} /> History
          </Link>
        </p>
      </div>
      <SettingEditor row={row} rateLimits={rateLimits} />
    </li>
  );
}
