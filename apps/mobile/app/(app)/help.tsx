import { Linking } from 'react-native';
import { Stack } from 'expo-router';
import { RETENTION_RULES, SEASON_RULES, SPEED_RULES, SPEED_RULES_VERSION, TERRITORY_RULES, TERRITORY_RULES_VERSION } from '@loopfield/core';
import { env } from '@/config/env';
import { fmtDistance } from '@/lib/format';
import { Banner, Button, Card, Screen, Section, Txt } from '@/components/ui';
import { useUnits } from '@/state/session';

/** S46 Help and game rules — loop rules, overlap, title margin, social audiences, health sources and recording guidance. */
export default function Help() {
  const units = useUnits();
  const T = TERRITORY_RULES;
  const S = SPEED_RULES;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Help and game rules' }} />
      <Banner tone="info" text={`Pilot rules: every number below is a proposed value that may change after field testing (${TERRITORY_RULES_VERSION}, ${SPEED_RULES_VERSION}).`} />
      <Section title="Claiming land with loops">
        <Txt>• Choose Territory before you start, then start a loop capture. Travel before the capture stays private.</Txt>
        <Txt>• Run any loop and finish within {T.closureMaxGapMeters.value} m of where the capture started, with good GPS at both ends.</Txt>
        <Txt>• Loops must be {fmtDistance(T.minLoopLengthMeters.value, units, 0)}–{fmtDistance(T.maxLoopLengthMeters.value, units, 0)} long and enclose at most {(T.maxCandidateAreaSquareMeters.value / 1_000_000).toFixed(0)} km².</Txt>
        <Txt>• The map is divided into small hexagonal cells. You claim the cells that lie fully inside your loop after a {T.boundaryUncertaintyBandMeters.value} m edge band that allows for GPS error.</Txt>
        <Txt>• Overlap: the latest eligible completed loop takes every cell it fully encloses, even if another runner held them.</Txt>
        <Txt>• Some areas (for example private, restricted or unsafe land) are unavailable and never awarded. Roads or parks appearing on the map does not by itself make an area eligible.</Txt>
        <Txt>• Gaps longer than {T.maxSampleGapSeconds.value} s, pauses during the capture, very weak GPS or implausible speeds stop a loop from counting. Missing movement is never filled in.</Txt>
        <Txt>• Results are checked on the server and published at least {SEASON_RULES.publicationDelayMinutes.value} minutes after the run. Runs must upload within {SEASON_RULES.lateUploadWindowHours.value} hours to count.</Txt>
      </Section>
      <Section title="Route titles">
        <Txt>• Titles are earned on reviewed routes, in their set direction, through the start gate, every checkpoint and the finish gate, staying within {S.corridorMeters.value} m of the course.</Txt>
        <Txt>• To take a title you must beat the record by a clear margin: the larger of {S.marginMinSeconds.value} s, {S.marginFraction.value * 100}% of the record, or the combined timing uncertainty. Near ties do not change the title.</Txt>
        <Txt>• Titles count only on the same version of a route. Speed never moves land, and land never protects a title.</Txt>
        <Txt>• Anyone can propose a route ({fmtDistance(S.minCourseLengthMeters.value, units, 0)}–{fmtDistance(S.maxCourseLengthMeters.value, units, 0)}) from one of their runs; reviewers check safety, public access and duplicates.</Txt>
      </Section>
      <Section title="Seasons">
        <Txt>• Land resets every {SEASON_RULES.seasonLengthDays.value}-day season. Final standings settle {SEASON_RULES.settlementDelayHours.value} hours after a season ends and are kept in Season history.</Txt>
        <Txt>• You can ask for a review of a result within {RETENTION_RULES.appealWindowDays.value} days. Corrections apply to everyone affected.</Txt>
      </Section>
      <Section title="Who sees what">
        <Txt>• Each post has an audience: only you, your followers, everyone signed in, or a group’s members. Mentions never widen it.</Txt>
        <Txt>• Your raw GPS trace is never shown to other runners. The public map shows only published cells and approved routes.</Txt>
        <Txt>• Clubs and communities are joined only by your own choice.</Txt>
        <Txt>• By default only mutual followers can message each other. Blocking stops messages and hides each other’s content.</Txt>
      </Section>
      <Section title="Health data">
        <Txt>• Health data from Apple Health or Health Connect is optional, stays on this phone, and is labelled with its source. Missing data is shown as missing, not zero.</Txt>
        <Txt>• Imported workouts are for your history only — they never claim land or titles.</Txt>
        <Txt>• Health summaries are descriptive and are not medical advice.</Txt>
      </Section>
      <Section title="Recording tips">
        <Txt>• Allow “Always” (iOS) or “All the time” (Android) location so a locked screen does not stop recording.</Txt>
        <Txt>• Some Android phones stop background apps aggressively. If runs get interrupted, exclude this app from battery optimisation.</Txt>
        <Txt>• If recording is interrupted, the app shows the gap when you return; you can resume or finish. It cannot recover movement while it was stopped.</Txt>
      </Section>
      {env.termsUrl ? <Button variant="ghost" label="Terms" onPress={() => void Linking.openURL(env.termsUrl!)} /> : null}
      {env.privacyUrl ? <Button variant="ghost" label="Privacy Notice" onPress={() => void Linking.openURL(env.privacyUrl!)} /> : null}
      <Card>
        <Txt variant="caption">Data retention: raw competitive GPS is kept for the season plus {RETENTION_RULES.rawEvidenceDaysAfterSettlement.value} days after settlement; imported health data up to {RETENTION_RULES.healthCacheDays.value} days on this phone.</Txt>
      </Card>
    </Screen>
  );
}
