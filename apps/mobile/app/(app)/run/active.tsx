import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { onCue, type Cue } from '@/lib/cues';
import { IconButton, PressableScale, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { tick } from '@/theme/motion';
import { defaultMapCenter } from '@/config/env';
import { mapboxModule } from '@/features/map/MapCanvas';
import { RunMap, type RunMapHandle } from '@/features/map/RunMap';
import { LiveParts, PreParts, PreRunScreen, recorderStyles as styles, StatsRun } from '@/features/run/RecorderParts';
import { useRecording, type LiveState } from '@/recording/useRecording';
import { spacing, useTheme } from '@/theme/tokens';

/**
 * The recorder (S20 pre-run and S21 recording on one screen). Where the map can be drawn (installed
 * builds) it fills the screen: before the run the bottom panel holds the run type and GO; once the run
 * starts the same map follows the runner and the panel shows distance, time, pace and the controls.
 * Elsewhere (browser, Expo Go) the screen leads with the numbers instead.
 */
export default function Recorder() {
  const live = useRecording();
  const params = useLocalSearchParams<{ course?: string }>();
  const [now, setNow] = useState(() => Date.now());
  const [cue, setCue] = useState<Cue | null>(null);
  useEffect(() => onCue(setCue), []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const course = params.course ?? null;
  if (mapboxModule()) return <MapRecorder live={live} now={now} cue={cue} course={course} />;
  return live.session ? <StatsRun live={live} now={now} cue={cue} /> : <PreRunScreen course={course} />;
}

/** The full-screen map stays mounted from choosing the run type to finishing it; the panels change over it. */
function MapRecorder({ live, now, cue, course }: { live: LiveState; now: number; cue: Cue | null; course: string | null }) {
  const t = useTheme();
  const p = t.palette;
  const insets = useSafeAreaInsets();
  const [following, setFollowing] = useState(true);
  const [threeD, setThreeD] = useState(true);
  const [topH, setTopH] = useState(insets.top + 64);
  const [panelH, setPanelH] = useState(300);
  const map = useRef<RunMapHandle>(null);
  const s = live.session;
  const panelBottom = insets.bottom + spacing.sm;
  // Map content (and Mapbox's logo and attribution) stays above the panel; buttons float just over it.
  const mapInsets = useMemo(() => ({ top: topH, bottom: panelBottom + panelH + spacing.xs }), [topH, panelBottom, panelH]);
  const above = panelBottom + panelH + spacing.md;
  const territory = s?.mode === 'territory' || s?.mode === 'territory_speed';
  const fallback = useMemo(() => defaultMapCenter(), []);

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <RunMap
        handle={map}
        path={live.path}
        captureStart={territory && s?.capture_state === 'open' ? live.captureStart : null}
        closing={live.closure === 'possible_closure'}
        threeD={threeD}
        insets={mapInsets}
        following={following}
        onFollowingChange={setFollowing}
        fallbackCenter={fallback}
        accessibilityLabel={`Map ${s ? 'of your run so far' : 'around you'}. ${following ? 'Following your position.' : 'Exploring the map; following resumes on its own.'} Only you can see this map.`}
      />

      {s ? (
        <LiveParts live={live} now={now} onTop={setTopH} onPanel={setPanelH} panelBottom={panelBottom} />
      ) : (
        <PreParts course={course} onTop={setTopH} onPanel={setPanelH} panelBottom={panelBottom} />
      )}

      <View pointerEvents="box-none" style={[styles.side, { bottom: above }]}>
        <IconButton variant="surface" icon="layers" label={threeD ? 'Switch to flat map' : 'Switch to 3D map'} color={threeD ? p.primary : p.textSubtle} onPress={() => setThreeD(!threeD)} />
        {following ? null : (
          <Animated.View entering={FadeIn} exiting={FadeOut}>
            <PressableScale onPress={() => { tick('light'); map.current?.recenter(); }} accessibilityRole="button" accessibilityLabel="Recenter on my position" style={[styles.recenter, { backgroundColor: p.primaryFill }, t.elevation.floating]}>
              <Icon name="locate" color="#FFFFFF" size={24} />
            </PressableScale>
          </Animated.View>
        )}
      </View>

      {cue && s ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.cue, { backgroundColor: p.ink, bottom: above, right: 76 }]}>
          <Icon name="volume" color={p.onInk} size={18} />
          <Txt variant="label" style={{ color: p.onInk, flex: 1 }}>{cue.text}</Txt>
        </Animated.View>
      ) : null}
    </View>
  );
}
