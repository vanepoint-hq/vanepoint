// Pairing URI (shown as a QR code by the desktop) and key-derivation helpers.
import { base64UrlDecode, base64UrlEncode, toHex, utf8Encode } from './bytes';
import { hash, keyedHash } from './crypto';

export interface PairingInfo {
  version: number;
  /** Desktop static X25519 public key (32 bytes). */
  desktopKey: Uint8Array;
  /** One-time 16-byte pairing secret. */
  secret: Uint8Array;
  hosts: string[];
  port: number;
  name: string;
  /** Expiry, Unix seconds. */
  expiresAt: number;
}

const SCHEME = 'vanepoint://pair';

export function buildPairingUri(p: PairingInfo): string {
  const q = [
    `v=${p.version}`,
    `k=${base64UrlEncode(p.desktopKey)}`,
    `s=${base64UrlEncode(p.secret)}`,
    `h=${p.hosts.map(encodeURIComponent).join(',')}`,
    `p=${p.port}`,
    `n=${encodeURIComponent(p.name)}`,
    `e=${p.expiresAt}`,
  ];
  return `${SCHEME}?${q.join('&')}`;
}

/** Parses without URL/URLSearchParams, which are incomplete in React Native. */
export function parsePairingUri(uri: string): PairingInfo {
  const trimmed = uri.trim();
  if (!trimmed.toLowerCase().startsWith(SCHEME)) throw new Error('Not a Vanepoint pairing code');
  const query = trimmed.slice(trimmed.indexOf('?') + 1);
  const params: Record<string, string> = {};
  for (const part of query.split('&')) {
    const i = part.indexOf('=');
    if (i > 0) params[part.slice(0, i)] = part.slice(i + 1);
  }
  const need = (k: string) => {
    if (params[k] === undefined || params[k] === '') throw new Error(`Pairing code is missing "${k}"`);
    return params[k];
  };
  const info: PairingInfo = {
    version: Number(need('v')),
    desktopKey: base64UrlDecode(need('k')),
    secret: base64UrlDecode(need('s')),
    hosts: need('h').split(',').map(decodeURIComponent).filter(Boolean),
    port: Number(need('p')),
    name: decodeURIComponent(params.n ?? 'Desktop'),
    expiresAt: Number(need('e')),
  };
  if (info.version !== 1) throw new Error(`Unsupported pairing version ${info.version}`);
  if (info.desktopKey.length !== 32) throw new Error('Invalid desktop key');
  if (info.secret.length !== 16) throw new Error('Invalid pairing secret');
  if (!Number.isInteger(info.port) || info.port <= 0 || info.port > 65535) throw new Error('Invalid port');
  return info;
}

/** psk = BLAKE2s(key = secret, data = "vanepoint-pair-v1"), 32 bytes. */
export function derivePairingPsk(secret: Uint8Array): Uint8Array {
  return keyedHash(secret, utf8Encode('vanepoint-pair-v1'));
}

/** Short, stable identifier for a static public key: first 8 bytes of BLAKE2s, hex. */
export function fingerprint(publicKey: Uint8Array): string {
  return toHex(hash(publicKey).subarray(0, 8));
}
