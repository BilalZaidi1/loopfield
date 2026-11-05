import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Txt } from '@/components/ui';
import { CommunityArt, HexBoard, ProgressArt } from '@/features/onboarding/Illustrations';
import { markTourSeen } from '@/features/onboarding/tour';
import { useSession } from '@/state/session';
import { useLayout } from '@/theme/layout';
import { radius, spacing, usePalette } from '@/theme/tokens';

/** First-run walkthrough of the whole app: how land, rivals, titles, progress and clubs fit together. */
const SLIDES: { title: string; body: string; art: (h: number) => ReactNode }[] = [
  {
    title: 'Run a loop, claim the ground',
    body: 'Start a territory run, run a loop and finish near where you began. The cells fully inside an eligible loop become yours on the shared map.',
    art: (h) => <HexBoard variant="claim" height={h} />
  },
  {
    title: 'Hold it against rivals',
    body: 'The newest eligible loop takes each cell, so ground changes hands. The Map shows who holds what nearby, and grey areas are never awarded.',
    art: (h) => <HexBoard variant="rivals" height={h} />
  },
  {
    title: 'Race for route titles',
    body: 'Approved routes have a set direction. Run one in a timed attempt and the fastest valid time holds the title, separate from land.',
    art: (h) => <HexBoard variant="route" height={h} />
  },
  {
    title: 'Watch yourself improve',
    body: 'Progress tracks weekly distance, goals and personal bests. Connect Apple Health or Health Connect for a dashboard that stays on your phone.',
    art: (h) => <ProgressArt height={h} />
  },
  {
    title: 'Run with your people',
    body: 'Follow runners, join clubs, chat and share runs with exactly the audience you choose. Start from the Clubs tab or Discover.',
    art: (h) => <CommunityArt height={h} />
  }
];

export default function Tour() {
  const p = usePalette();
  const { userId } = useSession();
  const { width, height, contentMax, gutter } = useLayout();
  const pageW = Math.min(width, contentMax);
  const [index, setIndex] = useState(0);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const artH = Math.min(300, Math.max(180, height * 0.34));
  const last = index === SLIDES.length - 1;

  const close = () => {
    void markTourSeen(userId);
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  };
  const goTo = (i: number) => {
    scroller.current?.scrollTo({ x: i * pageW, animated: true });
    setIndex(i);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / pageW);
    if (i !== index && i >= 0 && i < SLIDES.length) setIndex(i);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} edges={['top', 'bottom']}>
      <View style={{ width: pageW, alignSelf: 'center', flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: gutter, minHeight: 56 }}>
          <View style={{ flex: 1, flexDirection: 'row', gap: 6 }} accessibilityRole="progressbar" accessibilityLabel={`Page ${index + 1} of ${SLIDES.length}`}>
            {SLIDES.map((_, i) => (
              <View key={i} style={{ height: 6, width: i === index ? 24 : 6, borderRadius: radius.pill, backgroundColor: i === index ? p.primaryFill : p.borderStrong }} />
            ))}
          </View>
          {last ? null : <Button label="Skip" variant="ghost" size="sm" onPress={close} />}
        </View>
        <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} onScroll={onScroll} scrollEventThrottle={64} style={{ flex: 1 }}>
          {SLIDES.map((s, i) => (
            <View key={s.title} style={{ width: pageW, paddingHorizontal: gutter, paddingTop: spacing.lg, gap: spacing.xl }} accessibilityElementsHidden={i !== index} importantForAccessibility={i === index ? 'auto' : 'no-hide-descendants'}>
              {s.art(artH)}
              <View style={{ gap: spacing.md }}>
                <Txt variant="title">{s.title}</Txt>
                <Txt color="textMuted" style={{ fontSize: 17, lineHeight: 25 }}>{s.body}</Txt>
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={{ paddingHorizontal: gutter, paddingBottom: spacing.lg, paddingTop: spacing.md, gap: spacing.sm }}>
          <Button label={last ? 'Start exploring' : 'Next'} size="lg" arrow onPress={() => (last ? close() : goTo(index + 1))} />
          {index > 0 ? <Button label="Back" variant="ghost" onPress={() => goTo(index - 1)} /> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}
