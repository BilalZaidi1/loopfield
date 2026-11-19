import type { Metadata } from 'next';
import { RETENTION_RULES, SOCIAL_RULES, TERRITORY_RULES } from '@loopfield/core';
import { requireStaff } from '@/lib/auth';
import { getRules } from '@/lib/data';
import { viewerTimeZone } from '@/lib/tz';
import { dateTime, relativeTime } from '@/lib/format';
import type { RuleFamily, RuleVersion } from '@/lib/types';
import { ActionButton } from '@/components/client';
import { Badge, Banner, BannerAction, Card, ListGroup, PageHeader, Row, SegmentedLinks, Table } from '@/components/ui';
import { RulesForm } from './rules-form';
import { applyRulesNow, saveAndApplyRules, saveRules, setNextRules } from './actions';

export const metadata: Metadata = { title: 'Game rules' };

const FAMILIES: { value: RuleFamily; label: string; blurb: string }[] = [
  { value: 'territory', label: 'Loops and GPS', blurb: 'What counts as a loop that claims land, and the GPS and vehicle checks every run goes through.' },
  { value: 'speed', label: 'Speed routes', blurb: 'Which routes can be proposed and how route times are judged.' }
];

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ family?: string }> }) {
  await requireStaff();
  const [{ family: f }, rules, tz] = await Promise.all([searchParams, getRules(), viewerTimeZone()]);
  const family: RuleFamily = f === 'speed' ? 'speed' : 'territory';
  const meta = FAMILIES.find((x) => x.value === family)!;
  const catalog = rules.catalog.filter((r) => r.family === family);
  const versions = rules.versions.filter((v) => v.family === family);
  const byVersion = (v: string | undefined) => versions.find((x) => x.version === v);
  const nextV = byVersion(rules.next[family]);
  const main = rules.running.find((s) => s.kind === 'public') ?? rules.running[0];
  const runningV = byVersion(family === 'territory' ? main?.territory_rules_version : main?.speed_rules_version);
  const defaults = Object.fromEntries(catalog.map((r) => [r.key, r.default]));
  const pending = nextV && runningV && nextV.version !== runningV.version;

  return (
    <>
      <PageHeader title="Game rules" description="Rules are versioned per season. A change starts with the next season, so everyone in a season plays by the same rules; staff allowed to can also apply it to running seasons straight away. The server judges every run, so changes need no app update." />
      <SegmentedLinks label="Rule families" value={family} options={FAMILIES.map((x) => ({ value: x.value, label: x.label, href: `/rules?family=${x.value}` }))} />
      <p className="type-body text-muted -mt-2">{meta.blurb}</p>
      {pending ? (
        <Banner tone="info" text={<>The next season starts on <strong>{shortVersion(nextV.version)}</strong>; running seasons use <strong>{shortVersion(runningV.version)}</strong>.</>}
          action={rules.can_apply ? <BannerAction href="#versions">Apply now</BannerAction> : undefined} />
      ) : null}

      <RulesForm family={family} catalog={catalog} next={nextV?.values ?? defaults} running={runningV?.values ?? defaults}
        canEdit={rules.can_edit} canApply={rules.can_apply} save={saveRules} saveAndApply={saveAndApplyRules} />

      <section className="grid grid-cols-12 gap-4">
        <Card title="Running and upcoming seasons" className="col-span-12 xl:col-span-7 h-full">
          {rules.running.length ? (
            <Table head={['Season', 'Rules', 'Ends']}>
              {rules.running.map((s) => {
                const v = family === 'territory' ? s.territory_rules_version : s.speed_rules_version;
                return (
                  <tr key={s.season_id}>
                    <td><div className="font-semibold">{s.competition} · {s.number}</div><div className="type-caption text-muted">{s.status === 'scheduled' ? 'Starts ' + relativeTime(s.starts_at) : s.kind === 'permanent' ? 'All-time map' : 'Running'}</div></td>
                    <td><VersionBadge v={byVersion(v)} name={v} /></td>
                    <td className="whitespace-nowrap text-muted">{new Date(s.ends_at).getFullYear() > 9000 ? 'Never' : dateTime(s.ends_at, tz ?? 'UTC')}</td>
                  </tr>
                );
              })}
            </Table>
          ) : <p className="type-body text-muted">No season is running or scheduled.</p>}
        </Card>
        <ListGroup title="What stays in code" className="col-span-12 xl:col-span-5 h-full">
          <Row title="Map grid and boundary band" subtitle="Set when a season is created; changing them mid-season would redraw everyone’s land." value={`res ${TERRITORY_RULES.gridResolution.value} · ${TERRITORY_RULES.boundaryUncertaintyBandMeters.value} m`} />
          <Row title="Raw GPS kept after results are final" subtitle="A privacy-policy promise." value={`${RETENTION_RULES.rawEvidenceDaysAfterSettlement.value} days`} />
          <Row title="Appeal window" subtitle="A privacy-policy promise." value={`${RETENTION_RULES.appealWindowDays.value} days`} />
          <Row title="Moderation cases kept" value={`${RETENTION_RULES.moderationCaseDaysAfterClosure.value} days`} />
          <Row title="Analytics kept" value={`${RETENTION_RULES.analyticsMonths.value} months`} />
          <Row title="Data export links last" value={`${RETENTION_RULES.exportLinkHours.value} h`} />
          <Row title="Processing limits" subtitle="Protect the servers; wrong values break processing." value={`${TERRITORY_RULES.maxRingVertices.value.toLocaleString('en')} points · ${TERRITORY_RULES.maxCandidateCells.value.toLocaleString('en')} cells`} />
          <Row title="Photos" value={`${SOCIAL_RULES.maxOriginalImageBytes.value / 1024 / 1024} MB · ${SOCIAL_RULES.maxImageEdgePixels.value} px`} />
        </ListGroup>
      </section>

      <Card title="Versions" className="scroll-mt-20" >
        <div id="versions" />
        <Table head={['Version', 'Why', 'Seasons', '']}>
          {versions.map((v) => (
            <tr key={v.version}>
              <td>
                <div className="flex flex-wrap items-center gap-2"><VersionBadge v={v} name={v.version} />
                  {v.version === rules.next[family] ? <Badge label="Next season" tone="violet" /> : null}
                  {v.version === runningV?.version ? <Badge label="Running" tone="success" /> : null}
                </div>
                <div className="type-caption text-muted mt-1">{v.is_builtin ? 'Built in' : `By @${v.created_by ?? 'unknown'} ${relativeTime(v.created_at)}`}</div>
              </td>
              <td className="max-w-[420px]">
                <div>{v.note}</div>
                {Object.keys(v.overrides).length ? (
                  <div className="type-caption text-muted mt-1">{Object.entries(v.overrides).map(([k, val]) => `${catalog.find((c) => c.key === k)?.label ?? k}: ${val}`).join(' · ')}</div>
                ) : null}
              </td>
              <td className="tabular">{v.seasons}</td>
              <td className="text-right">
                <div className="flex flex-wrap justify-end gap-2">
                  {rules.can_edit && v.version !== rules.next[family] ? (
                    <ActionButton label="Use next season" size="sm" variant="secondary" title={`Start the next season on ${shortVersion(v.version)}?`}
                      action={setNextRules.bind(null, family, v.version)} />
                  ) : null}
                  {rules.can_apply && v.version !== runningV?.version ? (
                    <ActionButton label="Apply now" size="sm" variant="danger" confirmPhrase="APPLY" title={`Move running seasons to ${shortVersion(v.version)}?`}
                      description="Runs started from now on use this version; runs already recorded keep theirs."
                      action={applyRulesNow.bind(null, family, v.version)} />
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

function shortVersion(v: string): string {
  const m = v.match(/\+ops\.(\d+)$/);
  return m ? `version ${m[1]}` : 'built-in rules';
}

function VersionBadge({ v, name }: { v: RuleVersion | undefined; name: string }) {
  return <span title={name}><Badge label={shortVersion(name)} tone={v && !v.is_builtin ? 'violet' : 'muted'} /></span>;
}
