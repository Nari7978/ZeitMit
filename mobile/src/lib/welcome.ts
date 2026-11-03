// Whether this phone has seen the welcome screens (shown once, before the first login).
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'zeitmit.welcomed';

export const welcomeStore = {
  async load(): Promise<boolean> {
    try {
      return (Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY)) === '1';
    } catch {
      return false;
    }
  },
  async save() {
    try {
      if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, '1');
      else await SecureStore.setItemAsync(KEY, '1');
    } catch {
      // Not saved: the welcome shows again next time, which is harmless.
    }
  },
};
