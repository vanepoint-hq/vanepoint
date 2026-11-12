import { describe, expect, it } from 'vitest';
import {
  AirPointer,
  base64UrlDecode,
  base64UrlEncode,
  buildPairingUri,
  CLOSE,
  type ClientSession,
  connectToDesktop,
  decodeMessage,
  derivePairingPsk,
  DialTracker,
  encodeMessage,
  fingerprint,
  generateKeyPair,
  HANDSHAKE,
  InitiatorHandshake,
  type Message,
  OneEuroFilter,
  pairWithDesktop,
  parsePairingUri,
  PointingFrame,
  prologue,
  randomBytes,
  ReleaseVelocityEstimator,
  ReplayWindow,
  ResponderHandshake,
  TRANSPORT_KIND,
  type Transport,
  utf8Decode,
  utf8Encode,
  type WebSocketLike,
} from '../src';

describe('bytes', () => {
  it('round-trips base64url for every length', () => {
    for (let n = 0; n < 40; n++) {
      const b = randomBytes(n);
      expect(base64UrlDecode(base64UrlEncode(b))).toEqual(b);
    }
  });
});

describe('protocol', () => {
  const cases: Message[] = [
    { type: 'motion', tUs: 123456, vx: 812.5, vy: -40.25 },
    { type: 'scroll', tUs: 9, dx: 0, dy: -3 },
    { type: 'button', button: 1, down: true },
    { type: 'fling', tUs: 77, vx: 3000, vy: 10 },
    { type: 'dial', tUs: 5, deltaRad: 0.25, detents: -3 },
    { type: 'action', id: 7 },
    { type: 'control', body: { op: 'mode', mode: 'present' } },
    { type: 'haptic', pattern: 3, intensity: 200 },
    { type: 'ping', t1: 1_731_400_000_123_456 },
    { type: 'pong', t1: 1, t2: 2 ** 40, t3: 2 ** 40 + 5 },
    { type: 'ack', id: 65535 },
  ];
  it.each(cases)('encodes and decodes $type', (msg) => {
    const env = decodeMessage(encodeMessage(msg, 42, 1));
    expect(env).not.toBeNull();
    expect(env!.msgId).toBe(42);
    expect(env!.flags).toBe(1);
    expect(env!.msg).toEqual(msg);
  });
  it('produces 16-byte motion messages', () => {
    expect(encodeMessage({ type: 'motion', tUs: 0, vx: 1, vy: 2 }).length).toBe(16);
  });
  it('rejects truncated messages', () => {
    expect(decodeMessage(Uint8Array.of(0x01, 0, 0, 0, 1, 2))).toBeNull();
  });
});

describe('pairing', () => {
  it('round-trips the pairing URI', () => {
    const info = {
      version: 1,
      desktopKey: generateKeyPair().publicKey,
      secret: randomBytes(16),
      hosts: ['192.168.1.20', '10.0.0.5'],
      port: 47800,
      name: 'Studio PC & Co',
      expiresAt: 1_900_000_000,
    };
    const parsed = parsePairingUri(buildPairingUri(info));
    expect(parsed).toEqual(info);
  });
  it('derives a deterministic 32-byte psk and 16-hex fingerprint', () => {
    const s = randomBytes(16);
    expect(derivePairingPsk(s)).toEqual(derivePairingPsk(s));
    expect(derivePairingPsk(s).length).toBe(32);
    expect(fingerprint(generateKeyPair().publicKey)).toMatch(/^[0-9a-f]{16}$/);
  });
  it('rejects malformed codes', () => {
    expect(() => parsePairingUri('https://example.com')).toThrow();
    expect(() => parsePairingUri('vanepoint://pair?v=1&k=abc')).toThrow();
  });
});

function handshakePair(psk?: Uint8Array, responderPsk?: Uint8Array) {
  const phone = generateKeyPair();
  const desktop = generateKeyPair();
  const pattern = psk ? 'IKpsk1' : 'IK';
  const ini = new InitiatorHandshake({ pattern, staticKey: phone, remoteStatic: desktop.publicKey, prologue: prologue(1), psk });
  const res = new ResponderHandshake({ pattern, staticKey: desktop, prologue: prologue(1), psk: responderPsk ?? psk });
  return { phone, desktop, ini, res };
}

describe('noise', () => {
  it('completes IKpsk1 and authenticates both sides', () => {
    const psk = derivePairingPsk(randomBytes(16));
    const { phone, ini, res } = handshakePair(psk);
    const m1 = ini.writeMessage1(utf8Encode('hello desktop'));
    expect(utf8Decode(res.readMessage1(m1))).toBe('hello desktop');
    expect(res.remoteStatic).toEqual(phone.publicKey);
    const { message, transport: dt } = res.writeMessage2(utf8Encode('welcome'));
    const { payload, transport: pt } = ini.readMessage2(message);
    expect(utf8Decode(payload)).toBe('welcome');
    expect(utf8Decode(dt.open(pt.seal(utf8Encode('p→d')))!)).toBe('p→d');
    expect(utf8Decode(pt.open(dt.seal(utf8Encode('d→p')))!)).toBe('d→p');
  });

  it('fails IKpsk1 message 1 when the psk differs', () => {
    const { ini, res } = handshakePair(derivePairingPsk(randomBytes(16)), derivePairingPsk(randomBytes(16)));
    expect(() => res.readMessage1(ini.writeMessage1(utf8Encode('x')))).toThrow();
  });

  it('completes IK without a psk', () => {
    const { ini, res } = handshakePair();
    res.readMessage1(ini.writeMessage1(new Uint8Array(0)));
    const { message } = res.writeMessage2(new Uint8Array(0));
    expect(() => ini.readMessage2(message)).not.toThrow();
  });

  it('rejects tampered, replayed and accepts reordered frames', () => {
    const { ini, res } = handshakePair();
    res.readMessage1(ini.writeMessage1(new Uint8Array(0)));
    const { message, transport: dt } = res.writeMessage2(new Uint8Array(0));
    const pt: Transport = ini.readMessage2(message).transport;
    const f1 = pt.seal(utf8Encode('one'));
    const f2 = pt.seal(utf8Encode('two'));
    expect(utf8Decode(dt.open(f2)!)).toBe('two');
    expect(utf8Decode(dt.open(f1)!)).toBe('one'); // out of order is fine
    expect(dt.open(f1)).toBeNull(); // replay
    const f3 = pt.seal(utf8Encode('three'));
    f3[f3.length - 1] ^= 1;
    expect(dt.open(f3)).toBeNull(); // tampered
  });
});

describe('replay window', () => {
  it('rejects values older than the window', () => {
    const w = new ReplayWindow();
    w.update(5000);
    expect(w.check(5000 - ReplayWindow.SIZE)).toBe(false);
    expect(w.check(5000 - 10)).toBe(true);
    w.update(4990);
    expect(w.check(4990)).toBe(false);
    expect(w.check(5001)).toBe(true);
  });
});

describe('motion', () => {
  it('1€ filter reduces jitter at rest', () => {
    const f = new OneEuroFilter();
    let raw = 0;
    let out = 0;
    for (let i = 0; i < 200; i++) {
      const x = Math.sin(i * 1.7) * 0.05;
      const y = f.filter(x, i / 100);
      if (i > 20) {
        raw += x * x;
        out += y * y;
      }
    }
    expect(out).toBeLessThan(raw * 0.25);
  });

  it('pointing frame: turning right moves right, tilting up moves up (upright and flat grips)', () => {
    const frame = new PointingFrame();
    // Upright portrait, screen facing the user: gravity points along device -y.
    frame.capture([0, -1, 0]);
    expect(frame.project([0, -1, 0], [0, -1, 0]).yaw).toBeGreaterThan(0); // clockwise about up (-gamma)
    expect(frame.project([1, 0, 0], [0, -1, 0]).pitch).toBeGreaterThan(0); // back tilts up
    // Flat, face up, top edge towards the screen: gravity along -z.
    frame.capture([0, 0, -1]);
    expect(frame.project([0, 0, -1], [0, 0, -1]).yaw).toBeGreaterThan(0); // clockwise seen from above
    expect(frame.project([1, 0, 0], [0, 0, -1]).pitch).toBeGreaterThan(0); // top edge up
  });

  it('air pointer maps upward pitch to negative screen y', () => {
    const p = new AirPointer();
    p.recenter([0, 0, -1]);
    let v = { vx: 0, vy: 0 };
    for (let i = 0; i < 50; i++) v = p.process([1, 0, 0], [0, 0, -1], i / 100);
    expect(v.vy).toBeLessThan(0);
    expect(Math.abs(v.vx)).toBeLessThan(1);
  });

  it('estimates release velocity by least squares', () => {
    const e = new ReleaseVelocityEstimator(80);
    for (let t = 0; t <= 100; t += 8) e.add(t, t * 2, -t); // 2000 px/s right, 1000 px/s up
    const v = e.estimate(100);
    expect(v.vx).toBeCloseTo(2000, 0);
    expect(v.vy).toBeCloseTo(-1000, 0);
  });

  it('dial tracker counts detents in both directions across the wrap', () => {
    const d = new DialTracker(24);
    d.update(Math.PI - 0.05);
    let total = 0;
    for (let i = 1; i <= 21; i++) total += d.update(Math.PI - 0.05 + i * (Math.PI / 24)).detents;
    expect(total).toBe(10); // 10.5 detents clockwise, across the ±π wrap
    for (let i = 20; i >= 1; i--) total += d.update(Math.PI - 0.05 + i * (Math.PI / 24)).detents;
    expect(total).toBe(0); // back to +0.5 detent
  });
});

// ---------------------------------------------------------------- in-memory desktop mock
class FakeSocket implements WebSocketLike {
  binaryType = 'arraybuffer';
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  peer!: { receive(b: Uint8Array): void; closed(code: number): void };
  send(data: ArrayBuffer) {
    const b = new Uint8Array(data.slice(0));
    queueMicrotask(() => this.peer.receive(b));
  }
  close(code = 1000, reason = '') {
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
  deliver(b: Uint8Array) {
    queueMicrotask(() => this.onmessage?.({ data: b.slice().buffer }));
  }
}

function mockDesktop(opts: { approve: boolean; secret: Uint8Array }) {
  const key = generateKeyPair();
  const trusted: Uint8Array[] = [];
  const received: Message[] = [];
  const factory = (_url: string) => {
    const sock = new FakeSocket();
    let transport: Transport | null = null;
    sock.peer = {
      receive(b) {
        if (!transport) {
          const kind = b[0];
          const res = new ResponderHandshake({
            pattern: kind === HANDSHAKE.PAIR ? 'IKpsk1' : 'IK',
            staticKey: key,
            prologue: prologue(TRANSPORT_KIND.WEBSOCKET),
            psk: kind === HANDSHAKE.PAIR ? derivePairingPsk(opts.secret) : undefined,
          });
          try {
            res.readMessage1(b.subarray(1));
          } catch {
            sock.close(CLOSE.HANDSHAKE_FAILED);
            return;
          }
          const known = trusted.some((t) => t.every((x, i) => x === res.remoteStatic![i]));
          if (kind === HANDSHAKE.RECONNECT && !known) {
            sock.close(CLOSE.NOT_TRUSTED);
            return;
          }
          const accepted = kind === HANDSHAKE.RECONNECT || opts.approve;
          if (accepted && kind === HANDSHAKE.PAIR) trusted.push(res.remoteStatic!);
          const out = res.writeMessage2(utf8Encode(JSON.stringify({ accepted, desktop_name: 'Mock PC' })));
          transport = out.transport;
          sock.deliver(out.message);
          return;
        }
        const pt = transport.open(b);
        const env = pt && decodeMessage(pt);
        if (env) received.push(env.msg);
      },
      closed() {},
    };
    queueMicrotask(() => sock.onopen?.({}));
    return sock;
  };
  return { key, factory, received };
}

describe('session (against an in-memory desktop)', () => {
  const device = { deviceName: 'Test Phone', platform: 'test', appVersion: '0.1.0' };

  it('pairs, sends input, then reconnects with IK', async () => {
    const secret = randomBytes(16);
    const desk = mockDesktop({ approve: true, secret });
    const identity = generateKeyPair();
    const info = { version: 1, desktopKey: desk.key.publicKey, secret, hosts: ['mock'], port: 1, name: 'Mock', expiresAt: Date.now() / 1000 + 60 };
    const { session, desktop } = await pairWithDesktop({ info, identity, device, createSocket: desk.factory });
    expect(desktop.name).toBe('Mock PC');
    session.send({ type: 'motion', tUs: session.tUs, vx: 10, vy: -5 });
    await new Promise((r) => setTimeout(r, 10));
    expect(desk.received.some((m) => m.type === 'motion')).toBe(true);
    (session as ClientSession).close();
    const again = await connectToDesktop({ desktop, identity, device, createSocket: desk.factory });
    again.send({ type: 'button', button: 0, down: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(desk.received.some((m) => m.type === 'button')).toBe(true);
    again.close();
  });

  it('surfaces a declined pairing', async () => {
    const secret = randomBytes(16);
    const desk = mockDesktop({ approve: false, secret });
    const info = { version: 1, desktopKey: desk.key.publicKey, secret, hosts: ['mock'], port: 1, name: 'Mock', expiresAt: Date.now() / 1000 + 60 };
    await expect(pairWithDesktop({ info, identity: generateKeyPair(), device, createSocket: desk.factory })).rejects.toThrow(/declined/);
  });

  it('rejects reconnects from unknown phones', async () => {
    const desk = mockDesktop({ approve: true, secret: randomBytes(16) });
    const desktop = { name: 'Mock', publicKey: desk.key.publicKey, hosts: ['mock'], port: 1, fingerprint: '' };
    await expect(connectToDesktop({ desktop, identity: generateKeyPair(), device, createSocket: desk.factory })).rejects.toThrow(/no longer trusts/);
  });
});
