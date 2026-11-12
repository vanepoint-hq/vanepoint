// The haptic vocabulary (docs/DESIGN_SYSTEM.md), mapped onto expo-haptics primitives so it
// runs in Expo Go. Custom Core Haptics / VibrationEffect patterns arrive with a dev build.
import { HAPTIC_PATTERNS, type HapticPattern } from '@vanepoint/core';
import * as Haptics from 'expo-haptics';

let enabled = true;
let last = 0;
let lastDetent = 0;

export function setHapticsEnabled(on: boolean) {
  enabled = on;
}

export function haptic(pattern: HapticPattern) {
  if (!enabled) return;
  const now = Date.now();
  if (pattern === 'detent') {
    if (now - lastDetent < 16) return; // ≤ 60 Hz, faster spins become texture
    lastDetent = now;
  } else {
    if (now - last < 40) return;
    last = now;
  }
  const run = (): Promise<void> => {
    switch (pattern) {
      case 'click':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      case 'click_strong':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      case 'detent':
        return Haptics.selectionAsync();
      case 'edge':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
      case 'connected':
      case 'success':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      case 'disconnected':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      case 'warning':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  };
  run().catch(() => {});
}

export function hapticFromWire(id: number) {
  const p = HAPTIC_PATTERNS[id];
  if (p) haptic(p);
}
