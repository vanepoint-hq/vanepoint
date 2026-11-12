// Identity, paired desktop and settings, kept in the OS keychain/keystore via expo-secure-store.
import { base64UrlDecode, base64UrlEncode, type DesktopRecord, generateKeyPair, type KeyPair } from '@vanepoint/core';
import * as SecureStore from 'expo-secure-store';

const K_IDENTITY = 'vp.identity.v1';
const K_DESKTOP = 'vp.desktop.v1';
const K_SETTINGS = 'vp.settings.v1';

export interface Settings {
  speed: number;
  invertX: boolean;
  invertY: boolean;
  /** Hold-to-point (true) or always-on (false). */
  clutch: boolean;
  naturalScroll: boolean;
  haptics: boolean;
  leftHanded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  speed: 1,
  invertX: false,
  invertY: false,
  clutch: true,
  naturalScroll: true,
  haptics: true,
  leftHanded: false,
};

export async function loadIdentity(): Promise<KeyPair> {
  const raw = await SecureStore.getItemAsync(K_IDENTITY);
  if (raw) {
    try {
      const j = JSON.parse(raw) as { privateKey: string; publicKey: string };
      return { privateKey: base64UrlDecode(j.privateKey), publicKey: base64UrlDecode(j.publicKey) };
    } catch {
      /* regenerate below */
    }
  }
  const kp = generateKeyPair();
  await SecureStore.setItemAsync(K_IDENTITY, JSON.stringify({ privateKey: base64UrlEncode(kp.privateKey), publicKey: base64UrlEncode(kp.publicKey) }), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return kp;
}

export async function loadDesktop(): Promise<DesktopRecord | null> {
  const raw = await SecureStore.getItemAsync(K_DESKTOP);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    return { ...j, publicKey: base64UrlDecode(j.publicKey) };
  } catch {
    return null;
  }
}

export async function saveDesktop(d: DesktopRecord): Promise<void> {
  await SecureStore.setItemAsync(K_DESKTOP, JSON.stringify({ ...d, publicKey: base64UrlEncode(d.publicKey) }));
}

export async function forgetDesktop(): Promise<void> {
  await SecureStore.deleteItemAsync(K_DESKTOP);
}

export async function loadSettings(): Promise<Settings> {
  const raw = await SecureStore.getItemAsync(K_SETTINGS);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await SecureStore.setItemAsync(K_SETTINGS, JSON.stringify(s));
}
