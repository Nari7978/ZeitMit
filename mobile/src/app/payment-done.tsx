// Stripe Checkout hands control back with zeitmit://payment-done?kind&id&status.
// Usually the booking or gift flow is still open underneath and finishes the job, so this screen just steps
// out of the way. If Android restarted the app meanwhile, it confirms the payment itself.
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '../theme';
import { api } from '../api';
import { useStore } from '../store';
import { Txt } from '../ui/primitives';

export default function PaymentDone() {
  const { kind, id, status } = useLocalSearchParams<{ kind?: string; id?: string; status?: string }>();

  useEffect(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    void (async () => {
      const s = useStore.getState();
      if (status === 'success' && id && (kind === 'booking' || kind === 'gift')) {
        try {
          const r = await api<{ paid: boolean; code?: string }>('POST', `/${kind === 'gift' ? 'gifts' : 'bookings'}/${id}/confirm-payment`);
          if (r.paid) s.showToast(kind === 'gift' && r.code ? `Paid. Your gift code: ${r.code}` : 'Paid & request sent');
        } catch {
          s.showToast('We’re still confirming your payment. Check Bookings in a moment.');
        }
      }
      await s.refresh();
      if (kind === 'booking') useStore.setState({ btab: 'pending' });
      router.replace(kind === 'booking' ? '/bookings' : '/');
    })();
  }, [kind, id, status]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <ActivityIndicator color={colors.ink} />
      <Txt size={15} weight={600}>Confirming your payment…</Txt>
    </View>
  );
}
