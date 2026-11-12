// Device-motion samples in a consistent device frame (x right, y up/top edge, z out of the
// screen), angular rate in rad/s and gravity pointing towards the ground.
//
// expo-sensors maps rotationRate differently per platform (verified against SDK 58 sources):
//   iOS:     alpha = z, beta = y, gamma = x   (CoreMotion rotationRate, deg/s)
//   Android: alpha = x, beta = y, gamma = z   (TYPE_GYROSCOPE values[0..2], deg/s)
// accelerationIncludingGravity − acceleration equals gravity pointing down on both.
import type { Vec3 } from '@vanepoint/core';
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { Platform } from 'react-native';

const DEG = Math.PI / 180;

export interface MotionSample {
  omega: Vec3;
  gravityDown: Vec3;
  /** Seconds. */
  t: number;
}

let lpGravity: Vec3 | null = null;

export function toSample(m: DeviceMotionMeasurement): MotionSample | null {
  const r = m.rotationRate;
  if (!r) return null;
  const omega: Vec3 = Platform.OS === 'ios' ? [r.gamma * DEG, r.beta * DEG, r.alpha * DEG] : [r.alpha * DEG, r.beta * DEG, r.gamma * DEG];
  const a = m.accelerationIncludingGravity;
  const u = m.acceleration;
  let g: Vec3 = u ? [a.x - u.x, a.y - u.y, a.z - u.z] : [a.x, a.y, a.z];
  if (!u) {
    // No user-acceleration split available: low-pass to approximate gravity.
    lpGravity = lpGravity ? [lpGravity[0] * 0.9 + g[0] * 0.1, lpGravity[1] * 0.9 + g[1] * 0.1, lpGravity[2] * 0.9 + g[2] * 0.1] : g;
    g = lpGravity;
  }
  const t = r.timestamp && r.timestamp > 0 ? r.timestamp : Date.now() / 1000;
  return { omega, gravityDown: g, t };
}

/** Subscribes at ~100 Hz. Returns an unsubscribe function. */
export function subscribeMotion(onSample: (s: MotionSample) => void, intervalMs = 10): () => void {
  DeviceMotion.setUpdateInterval(intervalMs);
  const sub = DeviceMotion.addListener((m) => {
    const s = toSample(m);
    if (s) onSample(s);
  });
  return () => sub.remove();
}

export async function motionAvailable(): Promise<boolean> {
  try {
    return await DeviceMotion.isAvailableAsync();
  } catch {
    return false;
  }
}
