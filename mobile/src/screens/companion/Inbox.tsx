import { ConvoRow } from '../Messages';
import { CompShell } from './Shell';

export default function Inbox() {
  return (
    <CompShell title="Messages" pad={false}>
      <ConvoRow k="sam" />
      <ConvoRow k="tom" />
    </CompShell>
  );
}
