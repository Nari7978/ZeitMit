import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { BTAB, notifWhen, ST, type BTab } from '../data';
import { useStore } from '../store';
import { api, wsUrl } from '../api';
import { bookAgain, openCustomer, toBookings } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Enter, Row, Stripes, Txt, TypingDots, Photo } from '../ui/primitives';
import { CircleButton, PrimaryButton, useKeyboardShown, usePullRefresh } from '../ui/common';
import { convoContext } from './Messages';
import { locale, t } from '../i18n';

type Msg = { id: string; me: boolean; t: string; at: number; pending?: boolean };

const timeOf = (unix: number) =>
  new Intl.DateTimeFormat(locale(), { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(unix * 1000));
const dayOf = (unix: number) => {
  const w = notifWhen(unix);
  return w.g === 'Earlier' ? w.time : w.g;
};

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const cust = useStore((s) => s.convos.find((c) => c.id === id));
  const compSide = useStore((s) => s.compConvos.find((c) => c.id === id));
  const x = cust ?? compSide;
  const isComp = !cust && !!compSide;
  // The server decides; until the inbox has loaded, assume open (sending is checked again there).
  const open = x?.canSend ?? true;
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const scroller = useRef<ScrollViewInstance>(null);
  const ws = useRef<WebSocket | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTypingSent = useRef(0);
  const refresh = usePullRefresh(() => load());
  const keyboard = useKeyboardShown();
  const barBottom = keyboard ? 10 : Math.max(30, insets.bottom + 8);

  // Opened from a notification before the inbox loaded: fetch it once, then give up gracefully.
  const [missing, setMissing] = useState(false);
  const hasConvo = !!x;
  useEffect(() => {
    if (hasConvo) return;
    let alive = true;
    void useStore.getState().refresh().then(() => {
      const st = useStore.getState();
      if (alive && ![...st.convos, ...st.compConvos].some((c) => c.id === id)) setMissing(true);
    });
    return () => { alive = false; };
  }, [id, hasConvo]);

  const load = useCallback(async () => {
    try {
      setMsgs(await api<Msg[]>('GET', `/conversations/${id}/messages`));
      useStore.getState().markConvoRead(id);
    } catch (e) {
      useStore.getState().showToast((e as Error).message);
      setMsgs((m) => m ?? []);
    }
  }, [id]);

  // History + live socket (messages and typing). Reconnects if the socket drops.
  useEffect(() => {
    void load();
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const sock = new WebSocket(wsUrl(`/conversations/${id}/ws`));
      ws.current = sock;
      sock.onmessage = (e) => {
        let ev: { type: string; id?: string; from?: string; t?: string; at?: number };
        try { ev = JSON.parse(String(e.data)); } catch { return; }
        const me = useStore.getState().user?.id;
        if (ev.type === 'typing') {
          if (ev.from === me) return; // your own typing on another device
          setTyping(true);
          clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTyping(false), 3000);
        } else if (ev.type === 'closed') {
          // The booking was completed or cancelled: reload so both sides see the chat has ended.
          void useStore.getState().refresh();
        } else if (ev.type === 'message' && ev.from !== me) {
          setTyping(false);
          setMsgs((m) => (m && !m.some((x) => x.id === ev.id) ? [...m, { id: ev.id!, me: false, t: ev.t!, at: ev.at! }] : m));
          useStore.getState().markConvoRead(id);
          void api('GET', `/conversations/${id}/messages?before=0`).catch(() => {}); // clears server-side unread
        }
      };
      sock.onclose = () => { if (!closed) retry = setTimeout(connect, 3000); };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); clearTimeout(typingTimer.current); ws.current?.close(); };
  }, [id, load]);

  if (!x) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 }}>
        {missing ? (
          <>
            <Txt size={16} weight={700} align="center">This chat isn’t available</Txt>
            <PrimaryButton label="Back" height={46} radius={14} size={14} onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
          </>
        ) : (
          <ActivityIndicator color={colors.ink} />
        )}
      </View>
    );
  }
  const name = x.name;
  const st = x.status !== 'none' ? ST[x.status] : null;
  const canSend = draft.trim().length > 0;

  const onDraft = (t: string) => {
    setDraft(t);
    if (t && Date.now() - lastTypingSent.current > 2000 && ws.current?.readyState === 1) {
      ws.current.send(JSON.stringify({ type: 'typing' }));
      lastTypingSent.current = Date.now();
    }
  };
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const tmp: Msg = { id: 'tmp' + Date.now(), me: true, t: text, at: Math.floor(Date.now() / 1000), pending: true };
    setMsgs((m) => [...(m ?? []), tmp]);
    try {
      const saved = await api<Msg>('POST', `/conversations/${id}/messages`, { text });
      setMsgs((m) => (m ?? []).map((y) => (y.id === tmp.id ? saved : y)));
    } catch (e) {
      setMsgs((m) => (m ?? []).filter((y) => y.id !== tmp.id));
      setDraft(text);
      useStore.getState().showToast((e as Error).message);
    }
  };
  const openCtx = () => {
    if (isComp) {
      router.dismissTo('/companion/calendar');
      return;
    }
    const bk = useStore.getState().bookings.find((y) => y.id === x.bookingId);
    const tab = bk ? (Object.keys(BTAB) as BTab[]).find((k) => BTAB[k] === bk.status)! : 'upcoming';
    toBookings(tab);
  };

  // Day separators between messages.
  const rows: ({ sep: string } | Msg)[] = [];
  let lastDay = '';
  for (const m of msgs ?? []) {
    const d = dayOf(m.at);
    if (d !== lastDay) rows.push({ sep: d });
    lastDay = d;
    rows.push(m);
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.cream }}>
      <Row style={{ paddingTop: insets.top + 4, paddingHorizontal: 12, paddingBottom: 10, backgroundColor: colors.white, borderBottomWidth: 2, borderBottomColor: colors.ink, gap: 10 }}>
        <CircleButton icon="chevron-left" label="Back" size={40} iconSize={24} border={0} bg="transparent" onPress={() => router.back()} />
        <Pressable accessibilityRole="button" accessibilityLabel={t(`View ${name}’s profile`)} disabled={!isComp} onPress={() => openCustomer(x.customerId)} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 14, overflow: 'hidden' }}><Photo hue={x.hue} url={x.photoUrl} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={16} weight={700}>{name}</Txt>
          {typing ? (
            <Txt size={12} weight={600} color={colors.greenDeep}>typing…</Txt>
          ) : (
            <Txt size={12} color={colors.gray600}>{isComp ? 'Customer · tap to see their profile' : 'Usually replies within 2 hours'}</Txt>
          )}
        </View>
        </Pressable>
        <CircleButton icon="ellipsis" label="More options" size={40} iconSize={22} border={0} bg="transparent" onPress={() => useStore.getState().openSheet('chatmenu', { sheetChat: id })} />
      </Row>

      {st ? (
        <Box shadow={3} style={{ marginTop: 10, marginHorizontal: 12, borderRadius: 14 }}>
          <Pressable accessibilityRole="button" onPress={openCtx} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }}><Icon name="calendar" size={16} /></View>
            <Txt size={13} weight={600} style={{ flex: 1 }} numberOfLines={1}>{convoContext(x)}</Txt>
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
        refreshControl={refresh}
      >
        {msgs && !msgs.length && open ? (
          <Txt size={13} lh={1.5} color={colors.gray600} align="center" style={{ marginVertical: 30, alignSelf: 'center', maxWidth: 260 }}>
            Say hello and suggest a plan. Keep it respectful, public and on ZeitMit.
          </Txt>
        ) : null}
        {rows.map((m, i) =>
          'sep' in m ? (
            <Txt key={'s' + i} size={11} weight={600} ls={0.06} color={colors.gray500} style={{ alignSelf: 'center', marginTop: 10, marginBottom: 4, textTransform: 'uppercase' }}>{m.sep}</Txt>
          ) : (
            <Enter key={m.id} style={{ flexDirection: 'row', justifyContent: m.me ? 'flex-end' : 'flex-start', opacity: m.pending ? 0.6 : 1 }}>
              <View style={{ maxWidth: '76%', paddingTop: 10, paddingHorizontal: 14, paddingBottom: 8, borderWidth: 1, borderColor: colors.ink, backgroundColor: m.me ? colors.ink : colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: m.me ? 20 : 6, borderBottomRightRadius: m.me ? 6 : 20 }}>
                <Txt size={15} lh={1.4} color={m.me ? colors.white : colors.ink}>{m.t}</Txt>
                <Txt size={10.5} color={m.me ? 'rgba(255,255,255,.72)' : colors.gray500} align="right" style={{ marginTop: 3 }}>{timeOf(m.at)}</Txt>
              </View>
            </Enter>
          ),
        )}
        {typing ? (
          // Same shape as a received message, sized to the dots (a shadowed Box would stretch here on Android).
          <View accessibilityLabel={t(`${name} is typing`)} style={{ alignSelf: 'flex-start', height: 40, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: colors.ink, backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomRightRadius: 20, borderBottomLeftRadius: 6 }}>
            <TypingDots />
          </View>
        ) : null}
      </ScrollView>

      {!open ? (
        <View style={{ paddingTop: 14, paddingHorizontal: 20, paddingBottom: barBottom, backgroundColor: colors.white, borderTopWidth: 2, borderTopColor: colors.ink, gap: 10 }}>
          <Row style={{ gap: 10, alignItems: 'flex-start' }}>
            <Icon name="lock" size={18} color={colors.gray600} />
            <Txt size={13} lh={1.45} color={colors.gray800} style={{ flex: 1 }}>
              {x.status === 'completed' ? 'You’ve met, so this booking’s chat has ended.' : x.status === 'cancelled' ? 'This booking was cancelled, so its chat has ended.' : 'Chat opens with a paid booking. Each booking has its own chat.'}
            </Txt>
          </Row>
          {!isComp && x ? <PrimaryButton label="Book again" height={46} radius={14} size={14} onPress={() => bookAgain(x.cid)} /> : null}
        </View>
      ) : (
      <Row style={{ paddingTop: 10, paddingHorizontal: 12, paddingBottom: barBottom, backgroundColor: colors.white, borderTopWidth: 2, borderTopColor: colors.ink, gap: 8 }}>
        <TextInput
          value={draft}
          onChangeText={onDraft}
          onSubmitEditing={() => void send()}
          returnKeyType="send"
          submitBehavior="submit"
          accessibilityLabel="Message"
          placeholder={t(`Message ${name}…`)}
          placeholderTextColor={colors.gray400}
          style={[font('body'), { flex: 1, minWidth: 0, height: 46, paddingHorizontal: 18, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.sun, fontSize: 15, color: colors.ink, outlineStyle: 'none' } as object]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !canSend }} onPress={() => void send()} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: canSend ? colors.ink : colors.track, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrow-up" size={20} color={canSend ? colors.white : colors.gray500} />
        </Pressable>
      </Row>
      )}
    </KeyboardAvoidingView>
  );
}
