// "Free now · video date" on a companion's card: they can be booked for a video date that starts right away.
import { View } from 'react-native';
import { colors } from '../theme';
import { Row, Txt } from './primitives';

export function FreeNowPill({ short, style }: { short?: boolean; style?: object }) {
  return (
    <Row style={[{ alignSelf: 'flex-start', gap: 6, height: 24, paddingLeft: 8, paddingRight: 10, borderRadius: 999, backgroundColor: colors.mintSoft }, style]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green }} />
      <Txt size={12} weight={700} color={colors.greenDeep} numberOfLines={1}>{short ? 'Free now' : 'Free now · video date'}</Txt>
    </Row>
  );
}
