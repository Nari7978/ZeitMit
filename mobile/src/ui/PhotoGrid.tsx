// A companion's extra photos (besides the profile photo): three tiles per row, each with a remove button,
// empty tiles up to the minimum, and an add tile while there's room.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { colors } from '../theme';
import { GALLERY_MAX, GALLERY_MIN } from '../store';
import { Icon } from './Icon';
import { Photo } from './primitives';
import { t } from '../i18n';

export type GalleryPhoto = { id: string; url: string };

const GAP = 10;

export function PhotoGrid({ photos, adding, error, onAdd, onRemove }: {
  photos: GalleryPhoto[]; adding: boolean; error?: boolean; onAdd: () => void; onRemove: (id: string) => void;
}) {
  const [w, setW] = useState(0);
  const size = { width: (w - GAP * 2) / 3, height: ((w - GAP * 2) / 3) * 1.25, borderRadius: 16, borderWidth: 2, overflow: 'hidden' as const };
  const empty = Math.max(GALLERY_MIN - photos.length, photos.length < GALLERY_MAX ? 1 : 0);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
      {w ? photos.map((p, i) => (
        <View key={p.id} style={[size, { borderColor: colors.ink }]}>
          <Photo hue={0} url={p.url} />
          <Pressable
            accessibilityRole="button" accessibilityLabel={t(`Remove photo ${i + 1}`)} hitSlop={8} onPress={() => onRemove(p.id)}
            style={{ position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(17,17,17,.78)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="x" size={14} color={colors.white} strokeWidth={2.5} />
          </Pressable>
        </View>
      )) : null}
      {w ? Array.from({ length: empty }, (_, i) => (
        <Pressable
          key={'add' + i} accessibilityRole="button" accessibilityLabel={t(i ? 'Add another photo' : 'Add a photo')} disabled={adding} onPress={onAdd}
          style={[size, { borderStyle: 'dashed', borderColor: error ? colors.red : i ? colors.gray400 : colors.ink, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }]}
        >
          <Icon name={i ? 'plus' : adding ? 'hourglass' : 'image-plus'} size={i ? 18 : 24} color={i ? colors.gray400 : colors.ink} />
        </Pressable>
      )) : null}
    </View>
  );
}
