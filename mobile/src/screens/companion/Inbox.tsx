import { colors } from '../../theme';
import { useStore } from '../../store';
import { Txt } from '../../ui/primitives';
import { ConvoRow } from '../Messages';
import { CompShell } from './Shell';

export default function Inbox() {
  const convos = useStore((s) => s.compConvos);
  return (
    <CompShell title="Messages" pad={false}>
      {convos.map((x) => <ConvoRow key={x.id} x={x} />)}
      {!convos.length ? (
        <Txt size={14} color={colors.gray600} align="center" style={{ marginTop: 32, marginHorizontal: 36 }}>Messages from customers will appear here.</Txt>
      ) : null}
    </CompShell>
  );
}
