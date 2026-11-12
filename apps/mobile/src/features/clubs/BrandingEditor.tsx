import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { friendlyError } from '@/lib/api';
import { Banner, Button, ChipGroup, PressableScale, Section, Txt } from '@/components/ui';
import { radius, spacing, usePalette, useTheme, type BlockTone } from '@/theme/tokens';
import { useLayout } from '@/theme/layout';
import { prepareImage, uploadToBucket } from '@/features/social/media';
import { ARTWORKS, CLUB_TONES, ClubHeaderArt, clubTone } from './ClubBits';
import { useClubAdmin, type ClubArtwork, type ClubDetail, type ClubTone } from './api';

/**
 * Look: the logo (or a group's picture) and the cover, which is a photo (communities) or the chosen colour
 * with a design. Previewed exactly as members will see it, with the logo ringed as on the page, and saved
 * only on confirm. The colour also tints the monogram and the community's cards.
 */
export function BrandingEditor({ club }: { club: ClubDetail }) {
  const p = usePalette();
  const { width } = useWindowDimensions();
  const { gutter, contentMax } = useLayout();
  const admin = useClubAdmin(club);
  const [logo, setLogo] = useState<{ uri: string } | null>(null);
  const [cover, setCover] = useState<{ uri: string } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [artwork, setArtwork] = useState<ClubArtwork | 'plain' | null>(null);
  const [tone, setTone] = useState<ClubTone | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const community = club.kind === 'community';
  const dirty = Boolean(logo || cover || removePhoto || artwork || tone);
  const coverWidth = Math.min(contentMax, width) - gutter * 2;
  // A design replaces the cover photo (the photo would hide it).
  const dropsPhoto = removePhoto || Boolean(artwork && !cover);
  const hasPhoto = Boolean(cover || (club.cover_path && !dropsPhoto));
  const reset = () => {
    setLogo(null);
    setCover(null);
    setRemovePhoto(false);
    setArtwork(null);
    setTone(null);
  };
  const pick = async (aspect: [number, number]) => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect, quality: 0.9, exif: false });
    return res.canceled || !res.assets[0] ? null : (await prepareImage(res.assets[0].uri)).uri;
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let logoPath: string | null = null;
      let coverPath: string | null = null;
      if (logo) {
        logoPath = `${club.id}/logo-${Date.now()}.jpg`;
        await uploadToBucket('club-media', logoPath, logo.uri);
      }
      if (cover) {
        coverPath = `${club.id}/cover-${Date.now()}.jpg`;
        await uploadToBucket('club-media', coverPath, cover.uri);
      }
      await admin.branding.mutateAsync({
        logoPath,
        coverPath,
        artwork: artwork && artwork !== 'plain' ? artwork : null,
        clearArtwork: artwork === 'plain',
        clearCover: Boolean(club.cover_path) && dropsPhoto && !cover,
        tone
      });
      reset();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Look" icon="image">
      <ClubHeaderArt club={club} width={coverWidth} height={community ? 148 : 104} ring={p.bg} logoUri={logo?.uri ?? null}
        preview={{ photoUri: cover?.uri ?? null, removePhoto: dropsPhoto, artwork, tone }} />
      <Button label={community ? 'Choose logo' : 'Choose picture'} size="sm" variant="secondary" icon="camera" style={{ alignSelf: 'flex-start' }}
        onPress={() => void pick([1, 1]).then((uri) => uri && setLogo({ uri }))} />
      <View style={{ gap: spacing.sm }}>
        <Txt variant="label">Colour</Txt>
        <ToneSwatches value={tone ?? clubTone(club)} onChange={setTone} ring={p.text} />
      </View>
      <ChipGroup<ClubArtwork | 'plain'> label="Cover design" value={artwork ?? club.artwork ?? 'plain'} scroll
        onChange={(v) => { setArtwork(v); setCover(null); }}
        options={[{ value: 'plain', label: 'Plain' }, ...ARTWORKS.map((a) => ({ value: a.id, label: a.label }))]} />
      {community ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Button label={hasPhoto ? 'Change cover photo' : 'Use a cover photo'} size="sm" variant="secondary" icon="image"
            onPress={() => void pick([5, 2]).then((uri) => { if (uri) { setCover({ uri }); setRemovePhoto(false); setArtwork(null); } })} />
          {hasPhoto ? <Button label="Remove photo" size="sm" variant="ghost" onPress={() => { setCover(null); setRemovePhoto(true); }} /> : null}
        </View>
      ) : null}
      {club.cover_path && dropsPhoto && !cover ? <Txt variant="caption">Saving replaces the cover photo with the colour and design shown.</Txt> : null}
      {error ? <Banner tone="danger" text={error} /> : null}
      {dirty ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button label="Save the new look" arrow style={{ flex: 1 }} loading={busy} onPress={() => void save()} />
          <Button label="Discard" variant="ghost" onPress={reset} />
        </View>
      ) : <Txt variant="caption">Shown on the page, in lists, rankings, posts, invitations and challenge cards. Photos are re-encoded on your phone (location data removed) before upload.</Txt>}
    </Section>
  );
}

/** The five colours as round swatches; the chosen one gets a ring. */
function ToneSwatches({ value, onChange, ring }: { value: ClubTone | BlockTone; onChange: (t: ClubTone) => void; ring: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Colour">
      {CLUB_TONES.map((c) => {
        const selected = c.id === value;
        return (
          <PressableScale key={c.id} onPress={() => onChange(c.id)} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={c.label}
            style={{ width: 44, height: 44, borderRadius: radius.pill, padding: 3, borderWidth: 2, borderColor: selected ? ring : 'transparent' }}>
            <View style={{ flex: 1, borderRadius: radius.pill, backgroundColor: t.blocks[c.id].bg, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }} />
          </PressableScale>
        );
      })}
    </View>
  );
}
