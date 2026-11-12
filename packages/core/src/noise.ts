// Noise Protocol Framework (revision 34) — the IK and IKpsk1 patterns with 25519, ChaChaPoly
// and BLAKE2s, plus explicit-nonce ("stateless") transport framing.
//
//   IK:      <- s   ...   -> e, es, s, ss          <- e, ee, se
//   IKpsk1:  <- s   ...   -> e, es, s, ss, psk     <- e, ee, se
//
// In PSK handshakes every `e` token also calls MixKey(e.public) (spec §9.2).
import { concat, readU64, utf8Encode, writeU64 } from './bytes';
import {
  aeadDecrypt,
  aeadEncrypt,
  DHLEN,
  dh,
  generateKeyPair,
  HASHLEN,
  hash,
  hkdf,
  type KeyPair,
  TAGLEN,
} from './crypto';
import { ReplayWindow } from './replay';

export type HandshakePattern = 'IK' | 'IKpsk1';

export function protocolName(pattern: HandshakePattern): string {
  return `Noise_${pattern}_25519_ChaChaPoly_BLAKE2s`;
}

const EMPTY = new Uint8Array(0);

class SymmetricState {
  ck: Uint8Array;
  h: Uint8Array;
  private k: Uint8Array | null = null;
  private n = 0;

  constructor(name: string) {
    const bytes = utf8Encode(name);
    if (bytes.length <= HASHLEN) {
      this.h = new Uint8Array(HASHLEN);
      this.h.set(bytes);
    } else {
      this.h = hash(bytes);
    }
    this.ck = this.h;
  }

  mixHash(data: Uint8Array): void {
    this.h = hash(concat(this.h, data));
  }

  mixKey(ikm: Uint8Array): void {
    const [ck, tempK] = hkdf(this.ck, ikm, 2);
    this.ck = ck;
    this.k = tempK;
    this.n = 0;
  }

  mixKeyAndHash(ikm: Uint8Array): void {
    const [ck, tempH, tempK] = hkdf(this.ck, ikm, 3);
    this.ck = ck;
    this.mixHash(tempH);
    this.k = tempK;
    this.n = 0;
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    if (!this.k) {
      this.mixHash(plaintext);
      return plaintext;
    }
    const c = aeadEncrypt(this.k, this.n++, this.h, plaintext);
    this.mixHash(c);
    return c;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    if (!this.k) {
      this.mixHash(ciphertext);
      return ciphertext;
    }
    const p = aeadDecrypt(this.k, this.n, this.h, ciphertext);
    this.n++;
    this.mixHash(ciphertext);
    return p;
  }

  split(): [Uint8Array, Uint8Array] {
    const [k1, k2] = hkdf(this.ck, EMPTY, 2);
    return [k1, k2];
  }
}

export interface InitiatorOptions {
  pattern: HandshakePattern;
  staticKey: KeyPair;
  remoteStatic: Uint8Array;
  prologue: Uint8Array;
  psk?: Uint8Array;
}

/** The phone side: knows the desktop's static key in advance. */
export class InitiatorHandshake {
  private ss: SymmetricState;
  private e: KeyPair | null = null;

  constructor(private opts: InitiatorOptions) {
    if (opts.pattern === 'IKpsk1' && opts.psk?.length !== 32) throw new Error('IKpsk1 needs a 32-byte psk');
    this.ss = new SymmetricState(protocolName(opts.pattern));
    this.ss.mixHash(opts.prologue);
    this.ss.mixHash(opts.remoteStatic); // pre-message: <- s
  }

  writeMessage1(payload: Uint8Array, ephemeral?: KeyPair): Uint8Array {
    const { staticKey, remoteStatic, psk, pattern } = this.opts;
    const e = (this.e = ephemeral ?? generateKeyPair());
    this.ss.mixHash(e.publicKey);
    if (pattern === 'IKpsk1') this.ss.mixKey(e.publicKey);
    this.ss.mixKey(dh(e.privateKey, remoteStatic)); // es
    const encS = this.ss.encryptAndHash(staticKey.publicKey); // s
    this.ss.mixKey(dh(staticKey.privateKey, remoteStatic)); // ss
    if (pattern === 'IKpsk1') this.ss.mixKeyAndHash(psk!); // psk
    const encPayload = this.ss.encryptAndHash(payload);
    return concat(e.publicKey, encS, encPayload);
  }

  readMessage2(message: Uint8Array): { payload: Uint8Array; transport: Transport; handshakeHash: Uint8Array } {
    if (!this.e) throw new Error('writeMessage1 first');
    if (message.length < DHLEN + TAGLEN) throw new Error('message 2 too short');
    const re = message.subarray(0, DHLEN);
    this.ss.mixHash(re);
    if (this.opts.pattern === 'IKpsk1') this.ss.mixKey(re);
    this.ss.mixKey(dh(this.e.privateKey, re)); // ee
    this.ss.mixKey(dh(this.opts.staticKey.privateKey, re)); // se
    const payload = this.ss.decryptAndHash(message.subarray(DHLEN));
    const [k1, k2] = this.ss.split();
    return { payload, transport: new Transport(k1, k2), handshakeHash: this.ss.h };
  }
}

export interface ResponderOptions {
  pattern: HandshakePattern;
  staticKey: KeyPair;
  prologue: Uint8Array;
  psk?: Uint8Array;
}

/** The desktop side (implemented in Rust for production; this TS version is used in tests and mocks). */
export class ResponderHandshake {
  private ss: SymmetricState;
  private re: Uint8Array | null = null;
  remoteStatic: Uint8Array | null = null;

  constructor(private opts: ResponderOptions) {
    this.ss = new SymmetricState(protocolName(opts.pattern));
    this.ss.mixHash(opts.prologue);
    this.ss.mixHash(opts.staticKey.publicKey);
  }

  readMessage1(message: Uint8Array): Uint8Array {
    const { staticKey, pattern, psk } = this.opts;
    if (message.length < DHLEN + DHLEN + TAGLEN + TAGLEN) throw new Error('message 1 too short');
    const re = (this.re = message.slice(0, DHLEN));
    this.ss.mixHash(re);
    if (pattern === 'IKpsk1') this.ss.mixKey(re);
    this.ss.mixKey(dh(staticKey.privateKey, re)); // es
    const rs = this.ss.decryptAndHash(message.subarray(DHLEN, DHLEN + DHLEN + TAGLEN)); // s
    this.remoteStatic = rs;
    this.ss.mixKey(dh(staticKey.privateKey, rs)); // ss
    if (pattern === 'IKpsk1') this.ss.mixKeyAndHash(psk!); // psk
    return this.ss.decryptAndHash(message.subarray(DHLEN + DHLEN + TAGLEN));
  }

  writeMessage2(payload: Uint8Array): { message: Uint8Array; transport: Transport } {
    if (!this.re || !this.remoteStatic) throw new Error('readMessage1 first');
    const e = generateKeyPair();
    this.ss.mixHash(e.publicKey);
    if (this.opts.pattern === 'IKpsk1') this.ss.mixKey(e.publicKey);
    this.ss.mixKey(dh(e.privateKey, this.re)); // ee
    this.ss.mixKey(dh(e.privateKey, this.remoteStatic)); // se
    const enc = this.ss.encryptAndHash(payload);
    const [k1, k2] = this.ss.split();
    return { message: concat(e.publicKey, enc), transport: new Transport(k2, k1) };
  }
}

export const FRAME_HEADER_LEN = 9;

/**
 * Explicit-nonce transport. Every frame is `kid (1) | counter (u64 LE) | ciphertext`.
 * The counter is the AEAD nonce, so frames are self-describing and may arrive over any
 * transport or out of order; a sliding window rejects replays.
 */
export class Transport {
  private sendCounter = 0;
  private replay = new ReplayWindow();
  readonly kid = 0;

  constructor(
    private readonly sendKey: Uint8Array,
    private readonly recvKey: Uint8Array,
  ) {}

  get framesSent(): number {
    return this.sendCounter;
  }

  seal(plaintext: Uint8Array): Uint8Array {
    const n = this.sendCounter++;
    const ct = aeadEncrypt(this.sendKey, n, EMPTY, plaintext);
    const frame = new Uint8Array(FRAME_HEADER_LEN + ct.length);
    const v = new DataView(frame.buffer);
    frame[0] = this.kid;
    writeU64(v, 1, n);
    frame.set(ct, FRAME_HEADER_LEN);
    return frame;
  }

  /** Returns null for replayed, malformed or unauthentic frames. */
  open(frame: Uint8Array): Uint8Array | null {
    if (frame.length < FRAME_HEADER_LEN + TAGLEN) return null;
    const v = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    if (frame[0] !== this.kid) return null;
    const n = readU64(v, 1);
    if (!this.replay.check(n)) return null;
    try {
      const pt = aeadDecrypt(this.recvKey, n, EMPTY, frame.subarray(FRAME_HEADER_LEN));
      this.replay.update(n);
      return pt;
    } catch {
      return null;
    }
  }
}
