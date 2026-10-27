// Thin client for the ZeitMit API (backend/). Base URL can be overridden with EXPO_PUBLIC_API_URL.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://zeitmit-api.zeitmit.workers.dev').replace(/\/$/, '');

const TOKEN_KEY = 'zeitmit.session';
let token: string | null = null;

export const tokenStore = {
  async load() {
    try {
      token = Platform.OS === 'web' ? globalThis.localStorage?.getItem(TOKEN_KEY) ?? null : await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      token = null;
    }
    return token;
  },
  async save(t: string | null) {
    token = t;
    try {
      if (Platform.OS === 'web') {
        if (t) globalThis.localStorage?.setItem(TOKEN_KEY, t);
        else globalThis.localStorage?.removeItem(TOKEN_KEY);
      } else if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
      else await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch {
      // Storage unavailable: the session just won't survive a restart.
    }
  },
  get: () => token,
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Called when the server rejects the session (expired / suspended). */
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'No connection. Check your internet and try again.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, data?.error ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

export const wsUrl = (path: string) => `${API_URL.replace(/^http/, 'ws')}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token ?? '')}`;
