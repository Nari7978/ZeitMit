import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../theme';
import { useStore } from '../store';
import { toBookings, toCompanionMode } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Enter, H, Row, Txt } from '../ui/primitives';
import { PrimaryButton, SecondaryButton, StatusCover, TextButton, useTopPad } from '../ui/common';
import { useNavBottom } from '../ui/chrome';

export const initials = (name: string) => name.split(' ').map((w) => w[0]).join('').slice(0, 2);

export default function Account() {
  const top = useTopPad();
  const bottom = useNavBottom() + 90;
  const user = useStore((s) => s.user);
  const savedCount = useStore((s) => s.saved.length);
  const compStatus = useStore((s) => s.companionStatus);
  const { logout } = useStore.getState();
  if (!user) return null;
  const editUser = { name: user.name, bio: user.bio };
  const { openSheet, showToast } = useStore.getState();

  type RowDef = [icon: string, label: string, value: string, fn?: () => void];
  const groups: { title: string; rows: RowDef[] }[] = [
    { title: 'Account', rows: [
      ['user-round', 'Personal details', '', () => openSheet('edit', { edit: editUser })],
      ['heart', 'Saved companions', String(savedCount), () => openSheet('saved')],
      ['gift', 'Gift a date', '', () => openSheet('gift', { gift: { amt: 100, to: '', msg: '', done: false } })],
      ['credit-card', 'Payment methods', 'Visa ··42'],
      ['history', 'Booking history', '', () => toBookings('completed')],
    ] },
    { title: 'Preferences', rows: [['bell', 'Notifications', 'Bookings & messages'], ['compass', 'Discovery preferences', 'Optional'], ['globe', 'Language', 'English']] },
    { title: 'Privacy & safety', rows: [['lock', 'Privacy controls', ''], ['ban', 'Blocked accounts', '0'], ['key-round', 'Account security', '2-step on'], ['shield-check', 'Verification', 'Age confirmed']] },
    { title: 'Support', rows: [['life-buoy', 'Help centre', ''], ['users', 'Community guidelines', ''], ['file-text', 'Terms & privacy', '']] },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusCover color={colors.sun} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top, paddingBottom: bottom }}>
        <Enter>
          <Row style={{ paddingTop: 16, paddingHorizontal: 20, gap: 16 }}>
            <View style={{ width: 76, height: 76, borderRadius: 26, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }}>
              <H size={26}>{initials(user.name)}</H>
            </View>
            <View style={{ gap: 4, flex: 1, minWidth: 0 }}>
              <H size={24} ls={-0.025} numberOfLines={1}>{user.name}</H>
              <Txt size={13} color={colors.gray600}>Berlin · Member since {new Date(user.createdAt * 1000).getFullYear()}</Txt>
              <Row style={{ gap: 5 }}>
                <Icon name="shield-check" size={14} color={colors.green} />
                <Txt size={12} weight={600} color={colors.green}>Age confirmed 18+</Txt>
              </Row>
            </View>
          </Row>
          <View style={{ paddingTop: 16, paddingHorizontal: 20 }}>
            <SecondaryButton label="Edit profile" icon="pencil" height={44} onPress={() => openSheet('edit', { edit: editUser })} />
          </View>

          {compStatus === 'none' || compStatus === 'rejected' ? (
            <View style={{ marginTop: 20, marginHorizontal: 20, padding: 22, borderRadius: 24, backgroundColor: colors.ink, overflow: 'hidden' }}>
              <View style={{ position: 'absolute', right: -40, top: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,79,139,.35)' }} />
              <View style={{ gap: 8 }}>
                <Txt kind="mono" size={11} weight={600} ls={0.08} color={colors.sun}>COMPANION MODE</Txt>
                <Txt kind="display" weight={700} size={22} ls={-0.02} color={colors.white}>Become a Companion</Txt>
                <Txt size={14} lh={1.5} color="rgba(255,255,255,.75)">Offer friendship or date-style company around the things you enjoy. You choose the activities, the rate and the schedule.</Txt>
                <Pressable accessibilityRole="button" onPress={() => router.push('/become')} style={{ alignSelf: 'flex-start', marginTop: 8, height: 42, paddingHorizontal: 18, borderRadius: 12, backgroundColor: colors.white, justifyContent: 'center' }}>
                  <Txt size={14} weight={600}>Learn how it works</Txt>
                </Pressable>
              </View>
            </View>
          ) : (
            <Box shadow={4} style={{ marginTop: 20, marginHorizontal: 20, padding: 18, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 14 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt size={15} weight={700}>Companion profile</Txt>
                <View style={{ height: 24, paddingHorizontal: 10, borderRadius: 999, backgroundColor: compStatus === 'approved' ? colors.greenSoft : colors.amberSoft, justifyContent: 'center' }}>
                  <Txt size={12} weight={600} color={compStatus === 'approved' ? colors.greenDeep : colors.amberDeep}>{compStatus === 'approved' ? 'Live' : 'Under review'}</Txt>
                </View>
              </Row>
              <PrimaryButton label="Switch to companion mode" icon="repeat" height={46} radius={14} size={14} onPress={toCompanionMode} />
            </Box>
          )}

          {groups.map((g) => (
            <View key={g.title} style={{ paddingHorizontal: 20, marginTop: 24 }}>
              <Txt size={13} weight={600} color={colors.gray600} style={{ marginHorizontal: 4, marginBottom: 8 }}>{g.title}</Txt>
              <Box shadow={4} style={{ backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, borderRadius: 20, overflow: 'hidden' }}>
                {g.rows.map(([icon, label, value, fn]) => (
                  <Pressable
                    key={label}
                    accessibilityRole="button"
                    onPress={fn ?? (() => showToast(label + ' opens here (prototype)'))}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline, backgroundColor: pressed ? colors.sun : colors.white })}
                  >
                    <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.butter, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={icon} size={16} color={colors.gray800} />
                    </View>
                    <Txt size={15} style={{ flex: 1 }}>{label}</Txt>
                    <Txt size={13} color={colors.gray600}>{value}</Txt>
                    <Icon name="chevron-right" size={16} color={colors.gray400} />
                  </Pressable>
                ))}
              </Box>
            </View>
          ))}

          <View style={{ paddingHorizontal: 20, marginTop: 24, gap: 8 }}>
            <SecondaryButton label="Log out" height={50} radius={16} size={15} onPress={() => void logout()} />
            <View style={{ alignItems: 'center' }}>
              <TextButton label="Delete account" color={colors.red} onPress={() => openSheet('delete')} style={{ paddingVertical: 12 }} />
            </View>
          </View>
          <Txt size={12} color={colors.gray400} align="center" style={{ marginTop: 8 }}>ZeitMit 0.1 · Gute Zeit. Gute Gesellschaft.</Txt>
        </Enter>
      </ScrollView>
    </View>
  );
}
