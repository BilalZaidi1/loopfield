import { useRef, useState } from 'react';
import { Platform, ScrollView, View, type HostInstance } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as ImageManipulator from 'expo-image-manipulator';
import { Banner, Button, ChipGroup, PressableScale, Txt } from '@/components/ui';
import { friendlyError } from '@/lib/api';
import { uploadToBucket } from '@/features/social/media';
import { radius, spacing, usePalette } from '@/theme/tokens';
import { CartoonAvatar } from './CartoonAvatar';
import { AVATAR_LABELS, AVATAR_OPTIONS, shuffleAvatar, type AvatarSpec } from './spec';

type ColourKey = 'bg' | 'skin' | 'hairColor' | 'outfitColor' | 'extraColor';
type PartKey = 'hair' | 'face' | 'outfit' | 'extra';
const SECTIONS: { title: string; part?: PartKey; colour?: ColourKey; colourLabel?: string }[] = [
  { title: 'Skin', colour: 'skin' },
  { title: 'Hair', part: 'hair', colour: 'hairColor', colourLabel: 'Hair colour' },
  { title: 'Face', part: 'face' },
  { title: 'Outfit', part: 'outfit', colour: 'outfitColor', colourLabel: 'Outfit colour' },
  { title: 'Extras', part: 'extra', colour: 'extraColor', colourLabel: 'Extra colour' },
  { title: 'Background', colour: 'bg' }
];

/**
 * Build a cartoon avatar: pick a part or a colour and the preview updates at once. Saving draws the
 * portrait as a square image in the runner's own avatars folder (so it shows wherever a profile
 * picture does) and returns its path together with the parts, which are kept to edit it later.
 */
export function AvatarBuilder({ userId, initial, onSaved, onCancel }: {
  userId: string;
  initial: AvatarSpec;
  onSaved: (r: { path: string; spec: AvatarSpec }) => void;
  onCancel: () => void;
}) {
  const p = usePalette();
  const [spec, setSpec] = useState<AvatarSpec>(initial);
  const [seed, setSeed] = useState(() => Date.now() % 100_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shot = useRef<HostInstance>(null);
  const set = <K extends keyof AvatarSpec>(k: K, v: AvatarSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // 512 px square JPEG (the avatars bucket takes JPEG only); the corners carry the background colour.
      const png = await captureRef(shot, { format: 'png', quality: 1, width: 512, height: 512, result: Platform.OS === 'web' ? 'data-uri' : 'tmpfile' });
      const jpeg = await (await ImageManipulator.ImageManipulator.manipulate(png).renderAsync()).saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 });
      const path = `${userId}/avatar-cartoon-${Date.now()}.jpg`;
      await uploadToBucket('avatars', path, jpeg.uri);
      onSaved({ path, spec });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        {/* The inner square is what gets saved (its corners carry the background); the circle is only the preview. */}
        <View style={{ width: 168, height: 168, borderRadius: 84, overflow: 'hidden' }}>
          <View ref={shot} collapsable={false} style={{ width: 168, height: 168 }}>
            <CartoonAvatar spec={spec} size={168} round={false} label="Your avatar" />
          </View>
        </View>
        <Button label="Surprise me" icon="refresh" variant="secondary" size="sm" onPress={() => { const next = seed + 1; setSeed(next); setSpec(shuffleAvatar(next)); }} />
      </View>
      <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: spacing.lg }}>
        {SECTIONS.map((sec) => (
          <View key={sec.title} style={{ gap: spacing.sm }}>
            <Txt variant="heading">{sec.title}</Txt>
            {sec.part ? (
              <ChipGroup label={sec.title} showLabel={false} value={spec[sec.part]} scroll
                onChange={(v) => set(sec.part!, v as never)}
                options={(AVATAR_OPTIONS[sec.part] as readonly string[]).map((o) => ({ value: o, label: AVATAR_LABELS[o] ?? o }))} />
            ) : null}
            {sec.colour && !(sec.part === 'extra' && spec.extra === 'none') && !(sec.part === 'hair' && spec.hair === 'bald') ? (
              <Swatches label={sec.colourLabel ?? sec.title} value={spec[sec.colour]} options={AVATAR_OPTIONS[sec.colour]} onChange={(v) => set(sec.colour!, v)} ring={p.text} />
            ) : null}
          </View>
        ))}
      </ScrollView>
      {error ? <Banner tone="danger" text={error} /> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="Cancel" variant="ghost" onPress={onCancel} />
        <Button label="Use this avatar" arrow style={{ flex: 1 }} loading={busy} onPress={() => void save()} />
      </View>
    </View>
  );
}

function Swatches({ label, value, options, onChange, ring }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void; ring: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((c, i) => {
        const selected = c === value;
        return (
          <PressableScale key={c} onPress={() => onChange(c)} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${label} ${i + 1} of ${options.length}`}
            style={{ width: 40, height: 40, borderRadius: radius.pill, padding: 3, borderWidth: 2, borderColor: selected ? ring : 'transparent' }}>
            <View style={{ flex: 1, borderRadius: radius.pill, backgroundColor: c, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }} />
          </PressableScale>
        );
      })}
    </View>
  );
}
