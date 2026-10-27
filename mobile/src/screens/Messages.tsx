import { Pressable, ScrollView, View } from 'react-native';
import { colors } from '../theme';
import { AM, msgTime, ST, whenShort } from '../data';
import { useStore, type Convo } from '../store';
import { openChat } from '../nav';
import { Icon } from '../ui/Icon';
import { Enter, H, Row, Stripes, Txt } from '../ui/primitives';
import { StatusCover, useTopPad } from '../ui/common';
import { useNavBottom } from '../ui/chrome';

/** "City Walks · Tue 27 Oct, 14:00", or "No booking yet". */
export const convoContext = (x: Pick<Convo, 'act' | 'startsAt' | 'status'>) =>
  x.act && x.startsAt ? `${AM[x.act].label}${x.status === 'pending' ? ' request' : ''} · ${whenShort(x.startsAt)}` : 'No booking yet';

/** One conversation row, shared by the customer and companion inboxes. */
export function ConvoRow({ x }: { x: Convo }) {
  const st = x.status !== 'none' ? ST[x.status] : null;
  const unread = x.unread;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${x.name}${unread ? `, ${unread} unread` : ''}`}
      onPress={() => openChat(x.id)}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, backgroundColor: pressed ? colors.butter : 'transparent' })}
    >
      <View style={{ width: 56, height: 56, borderRadius: 18, overflow: 'hidden' }}><Stripes hue={x.hue} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: colors.ink }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 }}>
          <Txt size={16} weight={unread ? 700 : 600}>{x.name}</Txt>
          <Txt size={12} color={colors.gray600}>{x.last ? msgTime(x.lastAt) : ''}</Txt>
        </Row>
        <Row style={{ gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: st ? st.dot : colors.gray400 }} />
          <Txt size={12} color={colors.gray800}>{convoContext(x)}</Txt>
        </Row>
        <Row style={{ gap: 8 }}>
          <Txt size={14} color={unread ? colors.ink : colors.gray600} numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            {x.last ? (x.last.me ? 'You: ' : '') + x.last.t : 'Say hello and suggest a plan'}
          </Txt>
          {unread ? (
            <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 999, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Txt size={11} weight={700} color={colors.white}>{unread}</Txt>
            </View>
          ) : null}
        </Row>
      </View>
    </Pressable>
  );
}

export default function Messages() {
  const top = useTopPad();
  const bottom = useNavBottom() + 90;
  const convos = useStore((s) => s.convos);
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusCover color={colors.sun} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top, paddingBottom: bottom }}>
        <Enter>
          <View style={{ paddingTop: 8, paddingHorizontal: 20 }}><H size={30} ls={-0.035}>Messages</H></View>
          <Row style={{ marginTop: 14, marginHorizontal: 20, marginBottom: 8, gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.lilac }}>
            <Icon name="lock" size={16} />
            <Txt size={13} lh={1.4} color={colors.gray800} style={{ flex: 1 }}>Keep chats and payments on ZeitMit. We’ll never ask you to move elsewhere.</Txt>
          </Row>
          {convos.map((x) => <ConvoRow key={x.id} x={x} />)}
          {!convos.length ? (
            <Txt size={14} lh={1.5} color={colors.gray600} align="center" style={{ marginTop: 32, marginHorizontal: 36 }}>
              No messages yet. Open a companion’s profile and tap Message to say hello.
            </Txt>
          ) : null}
        </Enter>
      </ScrollView>
    </View>
  );
}
