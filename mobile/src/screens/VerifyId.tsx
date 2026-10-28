// ID check before the first booking: a photo of the ID document and a selfie holding it.
import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useStore } from '../store';
import { pickAndUpload } from '../lib/photos';
import { openBooking } from '../nav';
import { t } from '../i18n';
import { Icon } from '../ui/Icon';
import { Box, Enter, H, Row, Txt } from '../ui/primitives';
import { CircleButton, IconTile, PrimaryButton, StatusCover, TextButton } from '../ui/common';

type Slot = 'doc' | 'selfie';

export default function VerifyId() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const insets = useSafeAreaInsets();
  const user = useStore((s) => s.user!);
  const [photos, setPhotos] = useState<Partial<Record<Slot, string>>>({});
  const [uploading, setUploading] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const status = user.idStatus;

  const upload = async (slot: Slot, source: 'library' | 'camera') => {
    setUploading(slot);
    try {
      const r = await pickAndUpload('id', source);
      if (r) setPhotos((p) => ({ ...p, [slot]: r.id }));
    } catch (e) {
      useStore.getState().showToast((e as Error).message);
    } finally {
      setUploading(null);
    }
  };
  const choose = (slot: Slot) => {
    if (Platform.OS === 'web') return void upload(slot, 'library');
    Alert.alert(t(slot === 'doc' ? 'Photo of your ID' : 'Selfie with your ID'), undefined, [
      { text: t('Take photo'), onPress: () => void upload(slot, 'camera') },
      { text: t('Choose from library'), onPress: () => void upload(slot, 'library') },
      { text: t('Cancel'), style: 'cancel' },
    ]);
  };
  const submit = async () => {
    if (!photos.doc || !photos.selfie || busy) return;
    setBusy(true);
    await useStore.getState().submitVerification(photos.doc, photos.selfie);
    setBusy(false);
  };

  if (status === 'pending' || status === 'approved') {
    const ok = status === 'approved';
    return (
      <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 28, paddingBottom: 40, gap: 12 }}>
        <Enter kind="pop" style={{ width: 96, height: 96, marginBottom: 16, borderRadius: 32, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={ok ? 'badge-check' : 'hourglass'} size={40} color={colors.sun} />
        </Enter>
        <H size={28} ls={-0.03} align="center">{ok ? 'You’re verified' : 'We’re checking your ID'}</H>
        <Txt size={15} lh={1.55} color={colors.gray800} align="center">
          {ok ? 'Your ID check is done. You can book companions now.' : 'This usually takes less than 24 hours. We’ll send you a notification when you can book.'}
        </Txt>
        <View style={{ width: '100%', gap: 6, marginTop: 20 }}>
          {ok && next ? (
            <PrimaryButton label="Continue booking" onPress={() => { router.back(); openBooking(next); }} />
          ) : (
            <PrimaryButton label="Done" onPress={() => router.back()} />
          )}
        </View>
      </View>
    );
  }

  const slots: [Slot, string, string, string][] = [
    ['doc', 'id-card', 'Photo of your ID', 'National ID card, passport or residence permit. All four corners visible, no glare.'],
    ['selfie', 'scan-face', 'Selfie with your ID', 'Hold the same ID next to your face. We check that it’s really you.'],
  ];
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusCover color={colors.sun} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: 40 + insets.bottom }}>
        <Row style={{ paddingTop: 4, paddingHorizontal: 12 }}>
          <CircleButton icon="x" label="Close" size={40} iconSize={22} border={0} bg="transparent" onPress={() => router.back()} />
        </Row>
        <View style={{ paddingHorizontal: 20, gap: 14 }}>
          <H size={30} ls={-0.035} style={{ marginTop: 6 }}>Verify your ID</H>
          <Txt size={15} lh={1.55} color={colors.gray800}>
            To keep everyone safe, every customer verifies their ID once before their first booking. Companions see that you’re verified, never your documents.
          </Txt>
          {status === 'rejected' ? (
            <Box style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, backgroundColor: '#FCEBEE', borderWidth: 2, borderColor: colors.ink }}>
              <Icon name="circle-alert" size={20} color="#D9435F" />
              <View style={{ flex: 1 }}>
                <Txt size={14} weight={700}>Your last check wasn’t approved</Txt>
                <Txt size={13} lh={1.45} color={colors.gray800} style={{ marginTop: 2 }}>{user.idNote ?? 'The photos weren’t clear enough to verify you.'}</Txt>
                <Txt size={13} lh={1.45} color={colors.gray800} style={{ marginTop: 4 }}>Please try again with new photos.</Txt>
              </View>
            </Box>
          ) : null}
          {slots.map(([slot, icon, title, sub]) => {
            const done = !!photos[slot];
            return (
              <Box key={slot} shadow={4} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
                <IconTile icon={icon} iconSize={19} />
                <View style={{ flex: 1 }}>
                  <Txt size={15} weight={600}>{title}</Txt>
                  <Txt size={12} lh={1.4} color={colors.gray600} style={{ marginTop: 2 }}>{sub}</Txt>
                </View>
                {done ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Replace photo')} onPress={() => choose(slot)} style={{ height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.greenSoft, justifyContent: 'center' }}>
                    <Txt size={12} weight={600} color={colors.greenDeep}>Uploaded</Txt>
                  </Pressable>
                ) : (
                  <Pressable accessibilityRole="button" disabled={!!uploading} onPress={() => choose(slot)} style={{ height: 36, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.ink, justifyContent: 'center', opacity: uploading === slot ? 0.5 : 1 }}>
                    <Txt size={13} weight={600} color={colors.white}>{uploading === slot ? 'Uploading…' : 'Add photo'}</Txt>
                  </Pressable>
                )}
              </Box>
            );
          })}
          <Row style={{ gap: 10, alignItems: 'flex-start', marginTop: 2 }}>
            <Icon name="lock" size={16} color={colors.gray600} />
            <Txt size={12} lh={1.5} color={colors.gray600} style={{ flex: 1 }}>
              Only our review team sees these photos. They’re deleted as soon as the check is done.
            </Txt>
          </Row>
          <PrimaryButton label={busy ? 'Sending…' : 'Submit for review'} dim={!photos.doc || !photos.selfie || busy} onPress={() => void submit()} style={{ marginTop: 8 }} />
          <View style={{ alignItems: 'center' }}><TextButton label="Not now" size={15} onPress={() => router.back()} style={{ paddingVertical: 12 }} /></View>
        </View>
      </ScrollView>
    </View>
  );
}
