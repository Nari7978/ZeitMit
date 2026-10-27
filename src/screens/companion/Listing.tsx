import { View } from 'react-native';
import { colors } from '../../theme';
import { A } from '../../data';
import { toggleIn, useStore } from '../../store';
import { toCustomerMode } from '../../nav';
import { Box, Chip, Txt } from '../../ui/primitives';
import { SecondaryButton } from '../../ui/common';
import { RateStepper } from '../Become';
import { CompShell } from './Shell';

export default function Listing() {
  const cRate = useStore((s) => s.cRate);
  const cActs = useStore((s) => s.cActs);
  return (
    <CompShell title="Your listing">
      <Box shadow={4} style={{ padding: 18, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 14 }}>
        <Txt size={15} weight={700}>Hourly rate</Txt>
        <RateStepper bare rate={cRate} onChange={(r) => useStore.setState({ cRate: r })} />
        <Txt size={12} color={colors.gray600} align="center">Customers see your rate plus a separate 10% service fee.</Txt>
      </Box>
      <Box shadow={4} style={{ padding: 18, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 12 }}>
        <Txt size={15} weight={700}>Activities you offer</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {A.map((a) => (
            <Chip key={a.id} label={a.label} icon={a.icon} padL={11} padR={13} on={cActs.includes(a.id)} onPress={() => useStore.setState((s) => ({ cActs: toggleIn(s.cActs, a.id) }))} />
          ))}
        </View>
      </Box>
      <SecondaryButton label="Switch to customer mode" icon="repeat" iconSize={16} height={50} radius={16} size={15} onPress={toCustomerMode} />
    </CompShell>
  );
}
