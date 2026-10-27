// Pick (or take) a photo, shrink it on the phone, and upload it to the API (stored on the free plan).
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { api, API_URL } from '../api';

export type PhotoKind = 'avatar' | 'companion' | 'id';

const SIZE: Record<PhotoKind, number> = { avatar: 400, companion: 900, id: 1200 };

/** Absolute URL for a `/photos/…` path from the API. */
export const photoUri = (url?: string | null) => (url ? (url.startsWith('http') ? url : API_URL + url) : null);

/**
 * Lets the user choose a photo (or take one with the camera) and uploads it.
 * Returns the uploaded photo, or null if they cancelled. Throws on permission or upload errors.
 */
export async function pickAndUpload(kind: PhotoKind, source: 'library' | 'camera' = 'library') {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted && Platform.OS !== 'web') throw new Error(source === 'camera' ? 'Allow camera access in your phone settings to take a photo.' : 'Allow photo access in your phone settings to choose a picture.');
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: kind !== 'id', aspect: kind === 'avatar' ? [1, 1] : [4, 5], quality: 1 };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const wide = (a.width ?? 0) >= (a.height ?? 0);
  const small = await manipulateAsync(a.uri, [{ resize: wide ? { width: SIZE[kind] } : { height: SIZE[kind] } }], { compress: 0.72, format: SaveFormat.JPEG, base64: true });
  if (!small.base64) throw new Error('Couldn’t read that photo. Try another one.');
  return api<{ id: string; url: string }>('POST', '/photos', { kind, data: small.base64, mime: 'image/jpeg' });
}
