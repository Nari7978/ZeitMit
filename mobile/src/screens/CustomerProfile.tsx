// What a companion sees about someone who booked them (GET /companion/customers/:id): enough to know who they're
// meeting, never the email, phone or ID documents.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { AM, hours, memberSince, ST, type ActId, type BookingStatus, type Gender } from '../data';
import { api } from '../api';
import { hueOf, useStore } from '../store';
import { openBookingChat } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, H, Row, Txt } from '../ui/primitives';
import { CircleButton, Pill, PrimaryButton, SecondaryButton, StatusCover, usePullRefresh } from '../ui/common';
import { GENDERS } from './Become';
import { Initial } from './companion/Shell';

type Together = { id: string; act: ActId; startsAt: number; dur: number; status: BookingStatus; day: string; time: string };
type Customer = {
  id: string; name: string; bio: string; avatarUrl: string | null; verified: boolean; since: number; gender: Gender | null; age: number | null;
  languages: string[]; interests: string[]; meetups: number; together: Together[];
};

export default function CustomerProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [p, setP] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setP(await api<Customer>('GET', `/companion/customers/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const refresh = usePullRefresh(load);

  if (!p) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 }}>
        {error ? (
          <>
            <Txt size={16} weight={700} align="center">{error}</Txt>
            <PrimaryButton label="Back" height={46} radius={14} size={14} onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
          </>
        ) : <ActivityIndicator color={colors.ink} />}
      </View>
    );
  }
  const first = p.name.split(' ')[0];
  const gender = GENDERS.find(([g]) => g === p.gender)?.[1];
  const open = p.together.find((b) => b.status === 'pending' || b.status === 'confirmed');
  const { openSheet } = useStore.getState();

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusCover color={colors.sun} />
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={refresh} contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: 40 + insets.bottom }}>
        <Row style={{ paddingTop: 4, paddingHorizontal: 12 }}>
          <CircleButton icon="chevron-left" label="Back" size={40} iconSize={24} border={0} bg="transparent" onPress={() => router.back()} />
        </Row>
        <View style={{ alignItems: 'center', gap: 6, paddingHorizontal: 20, marginTop: 4 }}>
          <Box shadow={4} style={{ borderRadius: 32, borderWidth: 2, borderColor: colors.ink, overflow: 'hidden' }}>
            <Initial who={p.name} hue={hueOf(p.id)} url={p.avatarUrl} size={128} radius={30} fontSize={46} />
          </Box>
          <H size={28} ls={-0.03} align="center" style={{ marginTop: 10 }}>{p.age ? `${first}, ${p.age}` : p.name}</H>
          <Txt size={14} color={colors.gray600} align="center">{[gender, memberSince(p.since)].filter(Boolean).join(' · ')}</Txt>
          <Row style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Pill label={p.verified ? 'ID verified' : 'ID not verified'} icon={p.verified ? 'badge-check' : 'circle-alert'} bg={p.verified ? colors.mintSoft : colors.track} fg={p.verified ? colors.greenDeep : colors.gray600} height={28} />
            <Pill label={p.meetups === 1 ? '1 meet-up on ZeitMit' : `${p.meetups} meet-ups on ZeitMit`} icon="users" bg={colors.white} fg={colors.ink} height={28} />
          </Row>
        </View>

        <View style={{ paddingHorizontal: 20, gap: 14, marginTop: 22 }}>
          <Card title="About">
            <Txt size={15} lh={1.55} color={p.bio ? colors.gray900 : colors.gray600} align={p.bio ? 'justify' : undefined}>{p.bio || `${first} hasn’t written an intro yet.`}</Txt>
          </Card>
          {p.languages.length || p.interests.length ? (
            <Card>
              {p.languages.length ? <Tags title="Speaks" icon="languages" items={p.languages} /> : null}
              {p.interests.length ? <Tags title="Into" icon="sparkles" items={p.interests} /> : null}
            </Card>
          ) : null}
          <Card title={`Your bookings with ${first}`}>
            {p.together.map((b, i) => {
              const st = ST[b.status];
              return (
                <Row key={b.id} style={{ gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.hairline }}>
                  <Icon name={AM[b.act].icon} size={17} color={colors.gray600} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt size={14} weight={600}>{AM[b.act].label} · {hours(b.dur)}</Txt>
                    <Txt size={12} color={colors.gray600}>{b.day} · {b.time}</Txt>
                  </View>
                  <Pill label={st.l} bg={st.bg} fg={st.fg} height={24} />
                </Row>
              );
            })}
          </Card>
          {open ? <PrimaryButton label={`Message ${first}`} icon="message-circle" onPress={() => void openBookingChat(open.id)} /> : null}
          <Row style={{ gap: 10, alignItems: 'flex-start', paddingHorizontal: 4 }}>
            <Icon name="shield-check" size={16} color={colors.gray600} />
            <Txt size={12} lh={1.5} color={colors.gray600} style={{ flex: 1 }}>
              Meet in a public place and keep chats and payment on ZeitMit. If something feels wrong, you can decline, cancel or report.
            </Txt>
          </Row>
          <SecondaryButton label="Report" icon="flag" height={46} onPress={() => openSheet('report', { reportReason: null, reportTarget: p.id })} />
        </View>
      </ScrollView>
    </View>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Box shadow={4} style={{ padding: 16, borderRadius: 20, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 10 }}>
      {title ? <Txt size={15} weight={700}>{title}</Txt> : null}
      {children}
    </Box>
  );
}

function Tags({ title, icon, items }: { title: string; icon: string; items: string[] }) {
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ gap: 6 }}>
        <Icon name={icon} size={15} color={colors.gray600} />
        <Txt size={13} weight={600} color={colors.gray600}>{title}</Txt>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {items.map((x) => <Pill key={x} label={x} bg={colors.butter} fg={colors.ink} height={28} />)}
      </View>
    </View>
  );
}
