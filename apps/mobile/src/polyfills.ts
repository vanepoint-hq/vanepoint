// Hermes has no Web Crypto. The @noble libraries only need crypto.getRandomValues, which
// expo-crypto provides from the platform's secure random generator.
import { getRandomValues } from 'expo-crypto';

const g = globalThis as unknown as { crypto?: { getRandomValues?: unknown } };
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = getRandomValues;
}
