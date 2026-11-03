import { Redirect } from 'expo-router';
import Login from '../screens/Login';
import { useStore } from '../store';

/** First time on this phone, the welcome screens come before the login (the router would pick login by name). */
export default function LoginRoute() {
  const welcomed = useStore((s) => s.welcomed);
  return welcomed ? <Login /> : <Redirect href="/welcome" />;
}
