import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { useStore } from '../store';
import { Icon } from '../ui/Icon';
import { Box, H, Row, Txt } from '../ui/primitives';
import { PrimaryButton, TextButton } from '../ui/common';
import { Logo } from './Discover';
import { t } from '../i18n';

type Step = 'email' | 'code' | 'profile';

export default function Login() {
  const insets = useSafeAreaInsets();
  const { requestCode, verifyCode, finishSignup } = useStore.getState();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<TextInputInstance>(null);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const sendCode = () => run(async () => {
    const r = await requestCode(email.trim());
    if (!r.ok) return;
    setDevCode(r.devCode);
    setCode('');
    setStep('code');
    setTimeout(() => codeRef.current?.focus(), 150);
  });
  const checkCode = (v = code) => run(async () => {
    if (v.length < 6) return;
    const r = await verifyCode(email.trim(), v);
    if (r.ok && r.isNew) setStep('profile');
    if (!r.ok) setCode('');
  });
  const finish = () => run(async () => {
    if (!name.trim() || !adult) return;
    await finishSignup(name);
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.sun }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: Math.max(30, insets.bottom + 12) }}>
        <Logo size={24} />
        <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 32 }}>
          {step === 'email' && (
            <>
              <H size={52} lh={47} ls={-0.055}>
                Rent a date.{'\n'}
                <H size={52} ls={-0.055} color={colors.rose}>Or a mate.</H>
              </H>
              <Txt size={15} lh={1.5} color={colors.gray600} style={{ marginTop: 14, marginBottom: 24 }}>
                Real people for coffee, city walks, dates and plus-ones in Berlin. Always in public, always paid through ZeitMit.
              </Txt>
              <Label>Email</Label>
              <Field value={email} onChangeText={setEmail} placeholder={t("you@example.com")} keyboardType="email-address" autoCapitalize="none" autoComplete="email" onSubmitEditing={() => emailOk && sendCode()} />
              <PrimaryButton label={busy ? 'Sending…' : 'Continue'} dim={!emailOk || busy} onPress={sendCode} style={{ marginTop: 16 }} />
              <Txt size={12} lh={1.5} color={colors.gray600} align="center" style={{ marginTop: 14 }}>
                We’ll email you a 6-digit code. No password needed.
              </Txt>
            </>
          )}

          {step === 'code' && (
            <>
              <H size={32} ls={-0.035}>Check your email</H>
              <Txt size={15} lh={1.5} color={colors.gray600} style={{ marginTop: 8, marginBottom: 22 }}>
                Enter the 6-digit code we sent to <Txt size={15} weight={700}>{email.trim()}</Txt>.
              </Txt>
              <Pressable accessibilityLabel="Login code" onPress={() => codeRef.current?.focus()}>
                <Row style={{ gap: 8 }}>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <Box key={i} shadow={3} style={{ flex: 1, height: 60, borderRadius: 14, borderWidth: 2, borderColor: i === code.length ? colors.violet : colors.ink, backgroundColor: code[i] ? colors.butter : colors.white, alignItems: 'center', justifyContent: 'center' }}>
                      <H size={28}>{code[i] ?? ''}</H>
                    </Box>
                  ))}
                </Row>
                <TextInput
                  ref={codeRef}
                  value={code}
                  onChangeText={(t) => {
                    const v = t.replace(/\D/g, '').slice(0, 6);
                    setCode(v);
                    if (v.length === 6) void checkCode(v);
                  }}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  caretHidden
                  accessibilityLabel="Login code"
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, fontSize: 16 }}
                />
              </Pressable>
              {devCode ? (
                <Row style={{ marginTop: 16, gap: 8, padding: 12, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.ink, backgroundColor: colors.white }}>
                  <Icon name="info" size={16} />
                  <Txt size={13} style={{ flex: 1 }}>Test mode: emails aren’t sent yet. Your code is <Txt size={13} weight={700}>{devCode}</Txt>.</Txt>
                  <TextButton label="Use" size={13} weight={700} onPress={() => { setCode(devCode); void checkCode(devCode); }} />
                </Row>
              ) : null}
              <PrimaryButton label={busy ? 'Checking…' : 'Log in'} dim={code.length < 6 || busy} onPress={() => checkCode()} style={{ marginTop: 16 }} />
              <Row style={{ justifyContent: 'center', gap: 16, marginTop: 8 }}>
                <TextButton label="Change email" size={13} onPress={() => setStep('email')} />
                <TextButton label="Send a new code" size={13} onPress={sendCode} />
              </Row>
            </>
          )}

          {step === 'profile' && (
            <>
              <H size={32} ls={-0.035}>Welcome to ZeitMit</H>
              <Txt size={15} lh={1.5} color={colors.gray600} style={{ marginTop: 8, marginBottom: 22 }}>Just two things before you start.</Txt>
              <Label>Your name</Label>
              <Field value={name} onChangeText={setName} placeholder={t("e.g. Mira Hoffmann")} autoComplete="name" />
              <Txt size={12} color={colors.gray600} style={{ marginTop: 6 }}>Companions see your first name only.</Txt>
              <Box shadow={4} style={{ marginTop: 18, borderRadius: 18 }}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: adult }} onPress={() => setAdult(!adult)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
                  <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: adult ? colors.ink : colors.white, alignItems: 'center', justifyContent: 'center' }}>
                    {adult ? <Icon name="check" size={15} color={colors.white} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt size={15} weight={600}>I’m 18 or older</Txt>
                    <Txt size={12} color={colors.gray600} style={{ marginTop: 2 }}>ZeitMit is for adults only. Every booking is non-sexual and in public.</Txt>
                  </View>
                </Pressable>
              </Box>
              <PrimaryButton label={busy ? 'Saving…' : 'Start exploring'} dim={!name.trim() || !adult || busy} onPress={finish} style={{ marginTop: 20 }} />
            </>
          )}
        </View>
        <Txt size={11} lh={1.5} color={colors.gray600} align="center">By continuing you agree to the Terms and Community Guidelines.</Txt>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const Label = ({ children }: { children: string }) => <Txt size={13} weight={600} style={{ marginBottom: 6 }}>{children}</Txt>;

function Field(props: React.ComponentProps<typeof TextInput>) {
  return (
    <Box shadow={3} style={{ borderRadius: 14 }}>
      <TextInput
        placeholderTextColor={colors.gray400}
        {...props}
        style={[font('body'), { height: 52, paddingHorizontal: 16, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white, fontSize: 16, color: colors.ink, outlineStyle: 'none' } as object]}
      />
    </Box>
  );
}
