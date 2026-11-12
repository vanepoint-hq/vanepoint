// Cryptographic primitives for Noise_*_25519_ChaChaPoly_BLAKE2s, built on the audited
// pure-JS @noble libraries so they run unchanged on Hermes (React Native) and Node.
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519';
import { blake2s } from '@noble/hashes/blake2s';
import { hmac } from '@noble/hashes/hmac';
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils';
import { concat } from './bytes';

export const DHLEN = 32;
export const HASHLEN = 32;
export const TAGLEN = 16;

export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export function randomBytes(n: number): Uint8Array {
  return nobleRandomBytes(n);
}

export function generateKeyPair(): KeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

export function dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey);
}

export function hash(data: Uint8Array): Uint8Array {
  return blake2s(data);
}

/** Keyed BLAKE2s with a 32-byte output. */
export function keyedHash(key: Uint8Array, data: Uint8Array): Uint8Array {
  return blake2s(data, { key, dkLen: 32 });
}

function hmacHash(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(blake2s, key, data);
}

/** Noise HKDF (spec §4.3) returning two or three HASHLEN outputs. */
export function hkdf(chainingKey: Uint8Array, ikm: Uint8Array, outputs: 2 | 3): Uint8Array[] {
  const tempKey = hmacHash(chainingKey, ikm);
  const out1 = hmacHash(tempKey, Uint8Array.of(0x01));
  const out2 = hmacHash(tempKey, concat(out1, Uint8Array.of(0x02)));
  if (outputs === 2) return [out1, out2];
  const out3 = hmacHash(tempKey, concat(out2, Uint8Array.of(0x03)));
  return [out1, out2, out3];
}

/** ChaChaPoly nonce: 32 bits of zeros followed by a little-endian 64-bit counter. */
function nonce(n: number): Uint8Array {
  const b = new Uint8Array(12);
  const v = new DataView(b.buffer);
  v.setUint32(4, n % 0x1_0000_0000, true);
  v.setUint32(8, Math.floor(n / 0x1_0000_0000), true);
  return b;
}

export function aeadEncrypt(key: Uint8Array, n: number, ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
  return chacha20poly1305(key, nonce(n), ad).encrypt(plaintext);
}

/** Throws if authentication fails. */
export function aeadDecrypt(key: Uint8Array, n: number, ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return chacha20poly1305(key, nonce(n), ad).decrypt(ciphertext);
}
