import type { ReactNode } from 'react';
import { Linking, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { RETENTION_RULES, SEASON_RULES, SPEED_RULES, SPEED_RULES_VERSION, TERRITORY_RULES, TERRITORY_RULES_VERSION } from '@loopfield/core';
import { env } from '@/config/env';
import { fmtDistance } from '@/lib/format';
import { ArrowLink, Banner, Button, Card, Screen, Section, Txt } from '@/components/ui';
import { spacing, usePalette } from '@/theme/tokens';
import { useUnits } from '@/state/session';

/** S46 Help and game rules — loop rules, overlap, title margin, social audiences, health sources and recording guidance. */
function Bullet({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: p.primary, marginTop: 8 }} />
      <Txt style={{ flex: 1 }}>{children}</Txt>
    </View>
  );
}

export default function Help() {
  const units = useUnits();
  const T = TERRITORY_RULES;
  const S = SPEED_RULES;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Help and game rules' }} />
      <Card tone="violet">
        <Txt variant="headline">New here?</Txt>
        <Txt color="textMuted">The tour shows how land, rivals, route titles, progress and clubs fit together.</Txt>
        <Button label="Replay the app tour" arrow onPress={() => router.push('/tour')} />
      </Card>
      <Banner tone="info" text={`Pilot rules: every number below is a proposed value that may change after field testing (${TERRITORY_RULES_VERSION}, ${SPEED_RULES_VERSION}).`} />
      <Section title="Claiming land with loops" icon="hexagon">
        <Card>
        <Bullet>Choose Territory before you start, then start a loop capture. Travel before the capture stays private.</Bullet>
        <Bullet>Run any loop and finish within {T.closureMaxGapMeters.value} m of where the capture started, with good GPS at both ends.</Bullet>
        <Bullet>Loops must be {fmtDistance(T.minLoopLengthMeters.value, units, 0)}–{fmtDistance(T.maxLoopLengthMeters.value, units, 0)} long and enclose at most {(T.maxCandidateAreaSquareMeters.value / 1_000_000).toFixed(0)} km².</Bullet>
        <Bullet>The map is divided into small hexagonal cells. You claim the cells that lie fully inside your loop after a {T.boundaryUncertaintyBandMeters.value} m edge band that allows for GPS error.</Bullet>
        <Bullet>Overlap: the latest eligible completed loop takes every cell it fully encloses, even if another runner held them.</Bullet>
        <Bullet>Some areas (for example private, restricted or unsafe land) are unavailable and never awarded. Roads or parks appearing on the map does not by itself make an area eligible.</Bullet>
        <Bullet>Gaps longer than {T.maxSampleGapSeconds.value} s, pauses during the capture, very weak GPS or implausible speeds stop a loop from counting. Missing movement is never filled in.</Bullet>
        <Bullet>Results are checked on the server and published at least {SEASON_RULES.publicationDelayMinutes.value} minutes after the run. Runs must upload within {SEASON_RULES.lateUploadWindowHours.value} hours to count.</Bullet>
        </Card>
      </Section>
      <Section title="Route titles" icon="trophy">
        <Card>
        <Bullet>Titles are earned on reviewed routes, in their set direction, through the start gate, every checkpoint and the finish gate, staying within {S.corridorMeters.value} m of the course.</Bullet>
        <Bullet>To take a title you must beat the record by a clear margin: the larger of {S.marginMinSeconds.value} s, {S.marginFraction.value * 100}% of the record, or the combined timing uncertainty. Near ties do not change the title.</Bullet>
        <Bullet>Titles count only on the same version of a route. Speed never moves land, and land never protects a title.</Bullet>
        <Bullet>Anyone can propose a route ({fmtDistance(S.minCourseLengthMeters.value, units, 0)}–{fmtDistance(S.maxCourseLengthMeters.value, units, 0)}) from one of their runs; reviewers check safety, public access and duplicates.</Bullet>
        </Card>
      </Section>
      <Section title="Seasons" icon="calendar">
        <Card>
        <Bullet>Land resets every {SEASON_RULES.seasonLengthDays.value}-day season. Final standings settle {SEASON_RULES.settlementDelayHours.value} hours after a season ends and are kept in Season history.</Bullet>
        <Bullet>You can ask for a review of a result within {RETENTION_RULES.appealWindowDays.value} days. Corrections apply to everyone affected.</Bullet>
        </Card>
      </Section>
      <Section title="Who sees what" icon="eye">
        <Card>
        <Bullet>Each post has an audience: only you, your followers, everyone signed in, or a group’s members. Mentions never widen it.</Bullet>
        <Bullet>Your raw GPS trace is never shown to other runners. The public map shows only published cells and approved routes.</Bullet>
        <Bullet>Clubs and communities are joined only by your own choice.</Bullet>
        <Bullet>By default only mutual followers can message each other. Blocking stops messages and hides each other’s content.</Bullet>
        </Card>
      </Section>
      <Section title="Health data" icon="heart">
        <Card>
        <Bullet>Health data from Apple Health or Health Connect is optional, stays on this phone, and is labelled with its source. Missing data is shown as missing, not zero.</Bullet>
        <Bullet>Imported workouts are for your history only — they never claim land or titles.</Bullet>
        <Bullet>Health summaries are descriptive and are not medical advice.</Bullet>
        </Card>
      </Section>
      <Section title="Recording tips" icon="record">
        <Card>
        <Bullet>Allow “Always” (iOS) or “All the time” (Android) location so a locked screen does not stop recording.</Bullet>
        <Bullet>Some Android phones stop background apps aggressively. If runs get interrupted, exclude this app from battery optimisation.</Bullet>
        <Bullet>If recording is interrupted, the app shows the gap when you return; you can resume or finish. It cannot recover movement while it was stopped.</Bullet>
        </Card>
      </Section>
      {env.termsUrl || env.privacyUrl ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.xl }}>
          {env.termsUrl ? <ArrowLink label="Terms" onPress={() => void Linking.openURL(env.termsUrl!)} /> : null}
          {env.privacyUrl ? <ArrowLink label="Privacy Notice" onPress={() => void Linking.openURL(env.privacyUrl!)} /> : null}
        </View>
      ) : null}
      <Card>
        <Txt variant="caption">Data retention: raw competitive GPS is kept for the season plus {RETENTION_RULES.rawEvidenceDaysAfterSettlement.value} days after settlement; imported health data up to {RETENTION_RULES.healthCacheDays.value} days on this phone.</Txt>
      </Card>
    </Screen>
  );
}
