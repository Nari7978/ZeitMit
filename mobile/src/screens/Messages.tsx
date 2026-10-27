import { Pressable, ScrollView, View } from 'react-native';
import { colors } from '../theme';
import { CM, ST } from '../data';
import { useStore } from '../store';
import { openChat } from '../nav';
import { Icon } from '../ui/Icon';
import { Enter, H, Row, Stripes, Txt } from '../ui/primitives';
import { StatusCover, useTopPad } from '../ui/common';
import { useNavBottom } from '../ui/chrome';

/** One conversation row, shared by the customer and companion inboxes. */
export function ConvoRow({ k }: { k: string }) {
  const x = useStore((s) => s.convos[k]);
  const c = x.cid ? CM[x.cid] : null;
  const last = [...x.msgs].reverse().find((m) => !('sep' in m));
  const st = x.status !== 'none' ? ST[x.status] : null;
  const name = c ? c.name : x.name!;
  const unread = x.unread;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}${unread ? `, ${unread} unread` : ''}`}
      onPress={() => openChat(k)}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, backgroundColor: pressed ? colors.butter : 'transparent' })}
    >
      <View style={{ width: 56, height: 56, borderRadius: 18, overflow: 'hidden' }}><Stripes hue={c ? c.hue : x.hue!} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: colors.ink }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 }}>
          <Txt size={16} weight={unread ? 700 : 600}>{name}</Txt>
          <Txt size={12} color={colors.gray600}>{last && !('sep' in last) ? last.time : ''}</Txt>
        </Row>
        <Row style={{ gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: st ? st.dot : colors.gray400 }} />
          <Txt size={12} color={colors.gray800}>{x.ctx}</Txt>
        </Row>
        <Row style={{ gap: 8 }}>
          <Txt size={14} color={unread ? colors.ink : colors.gray600} numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            {last && !('sep' in last) ? (last.me ? 'You: ' : '') + last.t : 'Say hello and suggest a plan'}
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
  const corder = useStore((s) => s.corder);
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
          {corder.map((k) => <ConvoRow key={k} k={k} />)}
        </Enter>
      </ScrollView>
    </View>
  );
}
