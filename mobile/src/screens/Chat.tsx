import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { BTAB, CM, ST, type BTab } from '../data';
import { useStore } from '../store';
import { toBookings } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Enter, Row, Stripes, Txt, TypingDots } from '../ui/primitives';
import { CircleButton } from '../ui/common';

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const x = useStore((s) => s.convos[id]);
  const typing = useStore((s) => s.typing === id);
  const [draft, setDraft] = useState('');
  const scroller = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    useStore.getState().markConvoRead(id);
  }, [id]);

  if (!x) return null;
  const c = x.cid ? CM[x.cid] : null;
  const name = c ? c.name : x.name!;
  const st = x.status !== 'none' ? ST[x.status] : null;
  const isComp = x.side === 'comp';
  const canSend = draft.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    useStore.getState().sendMsg(id, draft);
    setDraft('');
  };
  const openCtx = () => {
    if (isComp) {
      router.dismissTo('/companion/calendar');
      return;
    }
    const bk = useStore.getState().bookings.find((y) => y.id === x.bid);
    const tab = bk ? (Object.keys(BTAB) as BTab[]).find((k) => BTAB[k] === bk.status)! : 'upcoming';
    toBookings(tab);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.cream }}>
      <Row style={{ paddingTop: insets.top + 4, paddingHorizontal: 12, paddingBottom: 10, backgroundColor: colors.white, borderBottomWidth: 2, borderBottomColor: colors.ink, gap: 10 }}>
        <CircleButton icon="chevron-left" label="Back" size={40} iconSize={24} border={0} bg="transparent" onPress={() => router.back()} />
        <View style={{ width: 40, height: 40, borderRadius: 14, overflow: 'hidden' }}><Stripes hue={c ? c.hue : x.hue!} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={16} weight={700}>{name}</Txt>
          <Txt size={12} color={colors.gray600}>{c ? 'Usually replies within 2 hours' : 'Customer · booking via ZeitMit'}</Txt>
        </View>
        <CircleButton icon="ellipsis" label="More options" size={40} iconSize={22} border={0} bg="transparent" onPress={() => useStore.getState().openSheet('chatmenu', { sheetChat: id })} />
      </Row>

      {st ? (
        <Box shadow={3} style={{ marginTop: 10, marginHorizontal: 12, borderRadius: 14 }}>
          <Pressable accessibilityRole="button" onPress={openCtx} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }}><Icon name="calendar" size={16} /></View>
            <Txt size={13} weight={600} style={{ flex: 1 }} numberOfLines={1}>{x.ctx}</Txt>
            <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 999, backgroundColor: st.bg, justifyContent: 'center' }}>
              <Txt size={11} weight={600} color={st.fg}>{st.l}</Txt>
            </View>
            <Icon name="chevron-right" size={16} color={colors.gray400} />
          </Pressable>
        </Box>
      ) : null}

      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 14, paddingBottom: 10, gap: 6 }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {x.msgs.length < 2 ? (
          <Txt size={13} lh={1.5} color={colors.gray600} align="center" style={{ marginVertical: 30, alignSelf: 'center', maxWidth: 260 }}>
            Say hello and suggest a plan. Keep it respectful, public and on ZeitMit.
          </Txt>
        ) : null}
        {x.msgs.map((m, i) =>
          'sep' in m ? (
            <Txt key={i} size={11} weight={600} ls={0.06} color={colors.gray500} style={{ alignSelf: 'center', marginTop: 10, marginBottom: 4, textTransform: 'uppercase' }}>{m.sep}</Txt>
          ) : (
            <Enter key={i} style={{ flexDirection: 'row', justifyContent: m.me ? 'flex-end' : 'flex-start' }}>
              <View style={{ maxWidth: '76%', paddingTop: 10, paddingHorizontal: 14, paddingBottom: 8, borderWidth: 1, borderColor: colors.ink, backgroundColor: m.me ? colors.ink : colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: m.me ? 20 : 6, borderBottomRightRadius: m.me ? 6 : 20 }}>
                <Txt size={15} lh={1.4} color={m.me ? colors.white : colors.ink}>{m.t}</Txt>
                <Txt size={10.5} color={m.me ? 'rgba(255,255,255,.72)' : colors.gray500} align="right" style={{ marginTop: 3 }}>{m.time}</Txt>
              </View>
            </Enter>
          ),
        )}
        {typing ? (
          <Box shadow={4} style={{ alignSelf: 'flex-start', paddingVertical: 14, paddingHorizontal: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomRightRadius: 20, borderBottomLeftRadius: 6, borderRadius: 20, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
            <TypingDots />
          </Box>
        ) : null}
      </ScrollView>

      <Row style={{ paddingTop: 10, paddingHorizontal: 12, paddingBottom: Math.max(30, insets.bottom + 8), backgroundColor: colors.white, borderTopWidth: 2, borderTopColor: colors.ink, gap: 8 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          returnKeyType="send"
          submitBehavior="submit"
          accessibilityLabel="Message"
          placeholder={`Message ${name}…`}
          placeholderTextColor={colors.gray400}
          style={[font('body'), { flex: 1, minWidth: 0, height: 46, paddingHorizontal: 18, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.sun, fontSize: 15, color: colors.ink, outlineStyle: 'none' } as object]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !canSend }} onPress={send} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: canSend ? colors.ink : colors.track, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrow-up" size={20} color={canSend ? colors.white : colors.gray500} />
        </Pressable>
      </Row>
    </KeyboardAvoidingView>
  );
}
