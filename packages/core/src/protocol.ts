// Vanepoint wire protocol v1 — message encoding (see docs/PROTOCOL.md).
import { readU64, utf8Decode, utf8Encode, writeU64 } from './bytes';

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 47800;
export const WS_PATH = '/v1/session';

/** First byte of the first WebSocket message selects the handshake. */
export const HANDSHAKE = { PAIR: 0x01, RECONNECT: 0x02 } as const;

export const TRANSPORT_KIND = { WEBSOCKET: 0x01, UDP: 0x02, BLE: 0x03 } as const;

export function prologue(transportKind: number): Uint8Array {
  const base = utf8Encode('Vanepoint/1');
  const out = new Uint8Array(base.length + 1);
  out.set(base);
  out[base.length] = transportKind;
  return out;
}

export const MSG = {
  MOTION: 0x01,
  SCROLL: 0x02,
  BUTTON: 0x03,
  FLING: 0x04,
  DIAL: 0x05,
  ACTION: 0x06,
  CONTROL: 0x10,
  HAPTIC: 0x11,
  PING: 0x12,
  PONG: 0x13,
  ACK: 0x14,
} as const;

export const FLAG = { ACK_REQ: 0x01, IS_ACK: 0x02 } as const;

export const HAPTIC_PATTERNS = [
  'click',
  'click_strong',
  'detent',
  'edge',
  'connected',
  'disconnected',
  'warning',
  'success',
] as const;
export type HapticPattern = (typeof HAPTIC_PATTERNS)[number];

export const MODES = ['air', 'trackpad', 'present', 'trackball', 'dial', 'gesture'] as const;
export type Mode = (typeof MODES)[number];

/** WebSocket close codes used by the desktop. */
export const CLOSE = {
  PAIRING_CLOSED: 4001,
  HANDSHAKE_FAILED: 4002,
  NOT_TRUSTED: 4003,
  DENIED: 4004,
  KILLED: 4005,
  REVOKED: 4006,
} as const;

export const BUTTONS = { left: 0, right: 1, middle: 2 } as const;
export type ButtonName = keyof typeof BUTTONS;

export type Message =
  | { type: 'motion'; tUs: number; vx: number; vy: number }
  | { type: 'scroll'; tUs: number; dx: number; dy: number }
  | { type: 'button'; button: number; down: boolean }
  | { type: 'fling'; tUs: number; vx: number; vy: number }
  | { type: 'dial'; tUs: number; deltaRad: number; detents: number }
  | { type: 'action'; id: number }
  | { type: 'control'; body: ControlBody }
  | { type: 'haptic'; pattern: number; intensity: number }
  | { type: 'ping'; t1: number }
  | { type: 'pong'; t1: number; t2: number; t3: number }
  | { type: 'ack'; id: number };

/** CONTROL messages are JSON objects with an `op` field. Unknown ops must be ignored. */
export type ControlBody = { op: string; [key: string]: unknown };

export interface Envelope {
  msg: Message;
  msgId: number;
  flags: number;
}

const HEADER = 4;

export function encodeMessage(msg: Message, msgId = 0, flags = 0): Uint8Array {
  let body: Uint8Array;
  let type: number;
  switch (msg.type) {
    case 'motion':
    case 'scroll':
    case 'fling': {
      type = msg.type === 'motion' ? MSG.MOTION : msg.type === 'scroll' ? MSG.SCROLL : MSG.FLING;
      body = new Uint8Array(12);
      const v = new DataView(body.buffer);
      v.setUint32(0, msg.tUs >>> 0, true);
      v.setFloat32(4, msg.type === 'scroll' ? msg.dx : msg.vx, true);
      v.setFloat32(8, msg.type === 'scroll' ? msg.dy : msg.vy, true);
      break;
    }
    case 'button':
      type = MSG.BUTTON;
      body = Uint8Array.of(msg.button & 0xff, msg.down ? 1 : 0);
      break;
    case 'dial': {
      type = MSG.DIAL;
      body = new Uint8Array(10);
      const v = new DataView(body.buffer);
      v.setUint32(0, msg.tUs >>> 0, true);
      v.setFloat32(4, msg.deltaRad, true);
      v.setInt16(8, Math.max(-32768, Math.min(32767, Math.round(msg.detents))), true);
      break;
    }
    case 'action': {
      type = MSG.ACTION;
      body = new Uint8Array(2);
      new DataView(body.buffer).setUint16(0, msg.id, true);
      break;
    }
    case 'control':
      type = MSG.CONTROL;
      body = utf8Encode(JSON.stringify(msg.body));
      break;
    case 'haptic':
      type = MSG.HAPTIC;
      body = Uint8Array.of(msg.pattern & 0xff, msg.intensity & 0xff);
      break;
    case 'ping': {
      type = MSG.PING;
      body = new Uint8Array(8);
      writeU64(new DataView(body.buffer), 0, msg.t1);
      break;
    }
    case 'pong': {
      type = MSG.PONG;
      body = new Uint8Array(24);
      const v = new DataView(body.buffer);
      writeU64(v, 0, msg.t1);
      writeU64(v, 8, msg.t2);
      writeU64(v, 16, msg.t3);
      break;
    }
    case 'ack': {
      type = MSG.ACK;
      body = new Uint8Array(2);
      new DataView(body.buffer).setUint16(0, msg.id, true);
      break;
    }
  }
  const out = new Uint8Array(HEADER + body.length);
  const v = new DataView(out.buffer);
  out[0] = type;
  out[1] = flags & 0xff;
  v.setUint16(2, msgId & 0xffff, true);
  out.set(body, HEADER);
  return out;
}

export function decodeMessage(buf: Uint8Array): Envelope | null {
  if (buf.length < HEADER) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const type = buf[0];
  const flags = buf[1];
  const msgId = v.getUint16(2, true);
  const len = buf.length - HEADER;
  const need = (n: number) => len >= n;
  let msg: Message | null = null;
  switch (type) {
    case MSG.MOTION:
    case MSG.FLING:
      if (need(12))
        msg = {
          type: type === MSG.MOTION ? 'motion' : 'fling',
          tUs: v.getUint32(4, true),
          vx: v.getFloat32(8, true),
          vy: v.getFloat32(12, true),
        };
      break;
    case MSG.SCROLL:
      if (need(12)) msg = { type: 'scroll', tUs: v.getUint32(4, true), dx: v.getFloat32(8, true), dy: v.getFloat32(12, true) };
      break;
    case MSG.BUTTON:
      if (need(2)) msg = { type: 'button', button: buf[4], down: buf[5] !== 0 };
      break;
    case MSG.DIAL:
      if (need(10)) msg = { type: 'dial', tUs: v.getUint32(4, true), deltaRad: v.getFloat32(8, true), detents: v.getInt16(12, true) };
      break;
    case MSG.ACTION:
      if (need(2)) msg = { type: 'action', id: v.getUint16(4, true) };
      break;
    case MSG.CONTROL:
      try {
        const body = JSON.parse(utf8Decode(buf.subarray(HEADER)));
        if (body && typeof body.op === 'string') msg = { type: 'control', body };
      } catch {
        msg = null;
      }
      break;
    case MSG.HAPTIC:
      if (need(2)) msg = { type: 'haptic', pattern: buf[4], intensity: buf[5] };
      break;
    case MSG.PING:
      if (need(8)) msg = { type: 'ping', t1: readU64(v, 4) };
      break;
    case MSG.PONG:
      if (need(24)) msg = { type: 'pong', t1: readU64(v, 4), t2: readU64(v, 12), t3: readU64(v, 20) };
      break;
    case MSG.ACK:
      if (need(2)) msg = { type: 'ack', id: v.getUint16(4, true) };
      break;
  }
  return msg ? { msg, msgId, flags } : null;
}

/** Microseconds since the Unix epoch (safe-integer range). */
export function nowMicros(): number {
  return Math.round(Date.now() * 1000);
}
