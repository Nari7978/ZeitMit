// A link to a screen that doesn't exist (old or mistyped): a friendly page instead of the router's developer screen.
import { View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../theme';
import { Icon } from '../ui/Icon';
import { H, Txt } from '../ui/primitives';
import { PrimaryButton, StatusCover } from '../ui/common';

export default function NotFound() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 10 }}>
      <StatusCover color={colors.sun} />
      <View style={{ width: 88, height: 88, marginBottom: 12, borderRadius: 28, backgroundColor: colors.white, borderWidth: 2.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="search-x" size={38} />
      </View>
      <H size={28} ls={-0.03} align="center">This page doesn’t exist</H>
      <Txt size={15} lh={1.5} color={colors.gray800} align="center">The link may be old or mistyped.</Txt>
      <PrimaryButton label="Go to the start" style={{ marginTop: 14, alignSelf: 'stretch' }} onPress={() => router.replace('/')} />
    </View>
  );
}
