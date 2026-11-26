import { useState } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import { radius, useTheme } from '@/theme/tokens';

const THUMB = 28;
const TRACK = 6;

/**
 * A one-thumb slider. Dragging anywhere on the track moves it; with a screen reader it is one adjustable
 * control that reads its value in words ("Start at 1.2 km") and moves by `accessibilityStep` per swipe.
 * `highlight` shades a span of the track (the part of a run the two stretch sliders choose) instead of
 * filling up to the thumb.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onSlidingStart,
  onSlidingEnd,
  label,
  valueText,
  accessibilityStep,
  highlight,
  disabled = false,
  testID
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onSlidingStart?: () => void;
  onSlidingEnd?: (v: number) => void;
  label: string;
  valueText: string;
  accessibilityStep?: number;
  highlight?: [number, number];
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const p = t.palette;
  const [width, setWidth] = useState(0);
  const span = Math.max(1e-9, max - min);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  const at = (x: number) => clamp(min + (Math.min(Math.max(x - THUMB / 2, 0), Math.max(1, width - THUMB)) / Math.max(1, width - THUMB)) * span);
  const frac = (v: number) => (Math.min(max, Math.max(min, v)) - min) / span;
  const pos = (v: number) => THUMB / 2 + frac(v) * Math.max(0, width - THUMB);
  const a11yStep = accessibilityStep ?? Math.max(step, Math.round(span / 20 / step) * step);
  const move = (e: GestureResponderEvent) => {
    const v = at(e.nativeEvent.locationX);
    if (v !== value) onChange(v);
  };
  const lo = highlight ? pos(Math.min(...highlight)) : THUMB / 2;
  const hi = highlight ? pos(Math.max(...highlight)) : pos(value);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: valueText }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (disabled) return;
        const next = clamp(value + (e.nativeEvent.actionName === 'increment' ? a11yStep : -a11yStep));
        if (next !== value) {
          onChange(next);
          onSlidingEnd?.(next);
        }
      }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        onSlidingStart?.();
        move(e);
      }}
      onResponderMove={move}
      onResponderRelease={(e) => onSlidingEnd?.(at(e.nativeEvent.locationX))}
      style={{ height: 44, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
      <View pointerEvents="none" style={{ marginHorizontal: THUMB / 2, height: TRACK, borderRadius: radius.pill, backgroundColor: p.surfaceSunken }} />
      {width > 0 ? (
        <>
          <View pointerEvents="none" style={{ position: 'absolute', left: lo, width: Math.max(0, hi - lo), height: TRACK, borderRadius: radius.pill, backgroundColor: p.primaryFill }} />
          <View pointerEvents="none"
            style={[{ position: 'absolute', left: pos(value) - THUMB / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: p.surface, borderWidth: 3, borderColor: p.primaryFill }, t.elevation.raised]} />
        </>
      ) : null}
    </View>
  );
}
