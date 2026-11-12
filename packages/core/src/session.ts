// Phone-side session client: pairing, reconnection and encrypted messaging over WebSocket.
// Transport-agnostic apart from the WebSocket factory, so it runs in React Native and Node.
import { concat, utf8Decode, utf8Encode } from './bytes';
import type { KeyPair } from './crypto';
import { InitiatorHandshake, type Transport } from './noise';
import { derivePairingPsk, fingerprint, type PairingInfo } from './pairing';
import {
  CLOSE,
  decodeMessage,
  encodeMessage,
  HANDSHAKE,
  type Message,
  nowMicros,
  PROTOCOL_VERSION,
  prologue,
  TRANSPORT_KIND,
  WS_PATH,
} from './protocol';

export interface WebSocketLike {
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface DeviceInfo {
  deviceName: string;
  platform: string;
  appVersion: string;
  capabilities?: string[];
}

export interface DesktopRecord {
  name: string;
  publicKey: Uint8Array;
  hosts: string[];
  port: number;
  fingerprint: string;
}

export class SessionError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

const CLOSE_MESSAGES: Record<number, string> = {
  [CLOSE.PAIRING_CLOSED]: 'The pairing code has expired or the pairing window was closed. Open a new code on the desktop.',
  [CLOSE.HANDSHAKE_FAILED]: 'The secure handshake failed. Scan a fresh pairing code.',
  [CLOSE.NOT_TRUSTED]: 'This desktop no longer trusts this phone. Pair again.',
  [CLOSE.DENIED]: 'Pairing was declined on the desktop.',
  [CLOSE.KILLED]: 'The desktop disconnected all devices (kill switch).',
  [CLOSE.REVOKED]: 'This phone was removed from the desktop.',
};

export function describeClose(code: number, reason?: string): string {
  return CLOSE_MESSAGES[code] ?? (reason ? `Disconnected: ${reason}` : `Disconnected (code ${code}).`);
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) return u8.buffer as ArrayBuffer;
  return u8.slice().buffer as ArrayBuffer;
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function openSocket(create: WebSocketFactory, url: string, timeoutMs: number): Promise<WebSocketLike> {
  return new Promise((resolve, reject) => {
    let done = false;
    let ws: WebSocketLike;
    try {
      ws = create(url);
    } catch (e) {
      reject(e);
      return;
    }
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new SessionError(`Timed out connecting to ${url}`));
    }, timeoutMs);
    ws.onopen = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new SessionError(`Could not connect to ${url}`));
    };
    ws.onclose = (ev) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new SessionError(describeClose(ev.code, ev.reason), ev.code));
    };
  });
}

/** Sends message 1 and resolves with message 2; frames arriving after it are queued. */
function exchange(ws: WebSocketLike, first: Uint8Array, timeoutMs: number): Promise<{ reply: Uint8Array; queued: Uint8Array[] }> {
  return new Promise((resolve, reject) => {
    const queued: Uint8Array[] = [];
    let reply: Uint8Array | null = null;
    const timer = setTimeout(() => {
      if (reply) return;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new SessionError('The desktop did not respond in time.'));
    }, timeoutMs);
    ws.onmessage = (ev) => {
      const b = toBytes(ev.data);
      if (!b) return;
      if (!reply) {
        reply = b;
        clearTimeout(timer);
        resolve({ reply, queued });
      } else {
        queued.push(b);
      }
    };
    ws.onclose = (ev) => {
      if (reply) return;
      clearTimeout(timer);
      reject(new SessionError(describeClose(ev.code, ev.reason), ev.code));
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.send(toArrayBuffer(first));
  });
}

function wsUrl(host: string, port: number): string {
  const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `ws://${h}:${port}${WS_PATH}`;
}

export class ClientSession {
  onMessage?: (msg: Message) => void;
  onClose?: (code: number, reason: string) => void;
  onRtt?: (ms: number) => void;

  private msgId = 0;
  private readonly startedAt = Date.now();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastRx = Date.now();
  private closed = false;
  rttMs: number | null = null;

  constructor(
    private readonly ws: WebSocketLike,
    private readonly transport: Transport,
    readonly desktop: DesktopRecord,
    readonly host: string,
    queued: Uint8Array[],
  ) {
    ws.onmessage = (ev) => {
      const b = toBytes(ev.data);
      if (b) this.handleFrame(b);
    };
    ws.onclose = (ev) => this.finish(ev.code, ev.reason);
    ws.onerror = () => {
      /* onclose follows */
    };
    for (const q of queued) this.handleFrame(q);
    this.pingTimer = setInterval(() => this.send({ type: 'ping', t1: nowMicros() }), 1000);
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastRx > 4500) {
        try {
          this.ws.close(1000, 'timeout');
        } catch {
          /* ignore */
        }
        this.finish(1006, 'Connection lost');
      }
    }, 1000);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** Microseconds since session start, wrapped to u32 as the protocol specifies. */
  get tUs(): number {
    return ((Date.now() - this.startedAt) * 1000) >>> 0;
  }

  send(msg: Message): void {
    if (this.closed) return;
    const pt = encodeMessage(msg, this.msgId);
    this.msgId = (this.msgId + 1) & 0xffff;
    try {
      this.ws.send(toArrayBuffer(this.transport.seal(pt)));
    } catch {
      this.finish(1006, 'Send failed');
    }
  }

  control(body: { op: string; [k: string]: unknown }): void {
    this.send({ type: 'control', body });
  }

  close(reason = 'user'): void {
    if (this.closed) return;
    try {
      this.control({ op: 'bye', reason });
      this.ws.close(1000, reason);
    } catch {
      /* ignore */
    }
    this.finish(1000, reason);
  }

  private handleFrame(frame: Uint8Array): void {
    const pt = this.transport.open(frame);
    if (!pt) return;
    this.lastRx = Date.now();
    const env = decodeMessage(pt);
    if (!env) return;
    const { msg } = env;
    if (msg.type === 'ping') {
      const t = nowMicros();
      this.send({ type: 'pong', t1: msg.t1, t2: t, t3: t });
      return;
    }
    if (msg.type === 'pong') {
      const t4 = nowMicros();
      const rtt = (t4 - msg.t1 - (msg.t3 - msg.t2)) / 1000;
      if (rtt >= 0 && rtt < 10_000) {
        this.rttMs = rtt;
        this.onRtt?.(rtt);
      }
      return;
    }
    this.onMessage?.(msg);
  }

  private finish(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.onClose?.(code, reason);
  }
}

interface HandshakeReply {
  accepted?: boolean;
  desktop_name?: string;
  protocol?: number;
  session_id?: string;
  reason?: string;
}

function handshakePayload(device: DeviceInfo): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      device_name: device.deviceName,
      platform: device.platform,
      app_version: device.appVersion,
      protocol: [PROTOCOL_VERSION],
      capabilities: device.capabilities ?? ['haptics'],
    }),
  );
}

export interface PairOptions {
  info: PairingInfo;
  identity: KeyPair;
  device: DeviceInfo;
  createSocket: WebSocketFactory;
  connectTimeoutMs?: number;
  /** How long to wait for the user to approve on the desktop. */
  approvalTimeoutMs?: number;
}

/** First-time pairing using the QR-code contents (Noise IKpsk1). */
export async function pairWithDesktop(opts: PairOptions): Promise<{ session: ClientSession; desktop: DesktopRecord }> {
  const { info } = opts;
  if (Date.now() / 1000 > info.expiresAt + 5) throw new SessionError('This pairing code has expired. Open a new one on the desktop.');
  const errors: string[] = [];
  for (const host of info.hosts) {
    let ws: WebSocketLike;
    try {
      ws = await openSocket(opts.createSocket, wsUrl(host, info.port), opts.connectTimeoutMs ?? 3000);
    } catch (e) {
      errors.push((e as Error).message);
      continue;
    }
    const hs = new InitiatorHandshake({
      pattern: 'IKpsk1',
      staticKey: opts.identity,
      remoteStatic: info.desktopKey,
      prologue: prologue(TRANSPORT_KIND.WEBSOCKET),
      psk: derivePairingPsk(info.secret),
    });
    const msg1 = concat(Uint8Array.of(HANDSHAKE.PAIR), hs.writeMessage1(handshakePayload(opts.device)));
    const { reply, queued } = await exchange(ws, msg1, opts.approvalTimeoutMs ?? 90_000);
    let payload: HandshakeReply;
    let transport: Transport;
    try {
      const r = hs.readMessage2(reply);
      transport = r.transport;
      payload = JSON.parse(utf8Decode(r.payload));
    } catch {
      ws.close(1000, 'handshake failed');
      throw new SessionError('The secure handshake failed. Scan a fresh pairing code.', CLOSE.HANDSHAKE_FAILED);
    }
    if (!payload.accepted) {
      ws.close(1000, 'declined');
      throw new SessionError(payload.reason ?? 'Pairing was declined on the desktop.', CLOSE.DENIED);
    }
    const desktop: DesktopRecord = {
      name: payload.desktop_name ?? info.name,
      publicKey: info.desktopKey,
      hosts: [host, ...info.hosts.filter((h) => h !== host)],
      port: info.port,
      fingerprint: fingerprint(info.desktopKey),
    };
    return { session: new ClientSession(ws, transport, desktop, host, queued), desktop };
  }
  throw new SessionError(`Could not reach the desktop. Make sure both devices are on the same Wi-Fi network.\n${errors.join('\n')}`);
}

export interface ConnectOptions {
  desktop: DesktopRecord;
  identity: KeyPair;
  device: DeviceInfo;
  createSocket: WebSocketFactory;
  connectTimeoutMs?: number;
}

/** Reconnects to an already-paired desktop (Noise IK, no PSK). */
export async function connectToDesktop(opts: ConnectOptions): Promise<ClientSession> {
  const { desktop } = opts;
  const errors: string[] = [];
  for (const host of desktop.hosts) {
    let ws: WebSocketLike;
    try {
      ws = await openSocket(opts.createSocket, wsUrl(host, desktop.port), opts.connectTimeoutMs ?? 2500);
    } catch (e) {
      errors.push((e as Error).message);
      continue;
    }
    const hs = new InitiatorHandshake({
      pattern: 'IK',
      staticKey: opts.identity,
      remoteStatic: desktop.publicKey,
      prologue: prologue(TRANSPORT_KIND.WEBSOCKET),
    });
    const msg1 = concat(Uint8Array.of(HANDSHAKE.RECONNECT), hs.writeMessage1(handshakePayload(opts.device)));
    const { reply, queued } = await exchange(ws, msg1, 10_000);
    let transport: Transport;
    let payload: HandshakeReply;
    try {
      const r = hs.readMessage2(reply);
      transport = r.transport;
      payload = JSON.parse(utf8Decode(r.payload));
    } catch {
      ws.close(1000, 'handshake failed');
      throw new SessionError('The secure handshake failed.', CLOSE.HANDSHAKE_FAILED);
    }
    if (!payload.accepted) {
      ws.close(1000, 'rejected');
      throw new SessionError(payload.reason ?? 'The desktop rejected the connection.', CLOSE.NOT_TRUSTED);
    }
    const ordered = { ...desktop, hosts: [host, ...desktop.hosts.filter((h) => h !== host)] };
    return new ClientSession(ws, transport, ordered, host, queued);
  }
  throw new SessionError(`Could not reach ${desktop.name}.\n${errors.join('\n')}`);
}
