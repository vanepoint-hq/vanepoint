#!/usr/bin/env -S npx tsx
/**
 * vanepoint-sim — a command-line "phone" for developing and testing the desktop agent.
 *
 *   npm run simulate -- pair "<vanepoint://pair?...>"      pair using a QR code's text
 *   npm run simulate -- run --script demo                  reconnect and run a script
 *   npm run simulate -- pair-and-run "<uri>" --script e2e  both (used by tools/e2e)
 *   npm run simulate -- connect --fresh-identity           expect rejection (unknown phone)
 *
 * Options: --state <file> (identity + paired desktop, default ~/.vanepoint-simulator.json),
 *          --script demo|circle|click|e2e|idle, --seconds N, --json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  base64UrlDecode,
  base64UrlEncode,
  type ClientSession,
  connectToDesktop,
  type DesktopRecord,
  generateKeyPair,
  type KeyPair,
  pairWithDesktop,
  parsePairingUri,
  SessionError,
  type WebSocketLike,
} from '@vanepoint/core';

interface State {
  identity: { privateKey: string; publicKey: string };
  desktop?: { name: string; publicKey: string; hosts: string[]; port: number; fingerprint: string };
}

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const positional = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
const statePath = option('state', join(homedir(), '.vanepoint-simulator.json'));
const json = flag('json');

function out(event: Record<string, unknown>) {
  if (json) console.log(JSON.stringify(event));
  else console.error(Object.entries(event).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' '));
}

function loadState(fresh: boolean): State {
  if (!fresh && existsSync(statePath)) return JSON.parse(readFileSync(statePath, 'utf8'));
  const kp = generateKeyPair();
  return { identity: { privateKey: base64UrlEncode(kp.privateKey), publicKey: base64UrlEncode(kp.publicKey) } };
}

function identityOf(s: State): KeyPair {
  return { privateKey: base64UrlDecode(s.identity.privateKey), publicKey: base64UrlDecode(s.identity.publicKey) };
}

function desktopOf(s: State): DesktopRecord {
  if (!s.desktop) throw new Error(`No paired desktop in ${statePath}. Run "pair" first.`);
  return { ...s.desktop, publicKey: base64UrlDecode(s.desktop.publicKey) };
}

const createSocket = (url: string) => {
  if (typeof WebSocket === 'undefined') {
    throw new Error(`The simulator needs Node.js 22 or later (built-in WebSocket). You are running ${process.version}.`);
  }
  const ws = new WebSocket(url);
  return ws as unknown as WebSocketLike;
};

const device = { deviceName: 'Vanepoint Simulator', platform: 'simulator', appVersion: '0.1.0', capabilities: ['haptics'] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function attach(session: ClientSession) {
  session.onMessage = (m) => {
    if (m.type === 'control') out({ type: 'control', op: m.body.op, profile: m.body.op === 'profile' ? ((m.body.profile as { name?: string } | null)?.name ?? null) : undefined });
    else if (m.type === 'haptic') out({ type: 'haptic', pattern: m.pattern });
  };
  session.onRtt = (ms) => out({ type: 'rtt', ms: Math.round(ms * 10) / 10 });
  session.onClose = (code, reason) => out({ type: 'closed', code, reason });
}

/** Streams velocities at 100 Hz for `seconds`, like the Air Pointer does. */
async function stream(session: ClientSession, seconds: number, velocity: (t: number) => [number, number]) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < seconds && session.isOpen) {
    const t = (Date.now() - start) / 1000;
    const [vx, vy] = velocity(t);
    session.send({ type: 'motion', tUs: session.tUs, vx, vy });
    await sleep(10);
  }
  session.send({ type: 'motion', tUs: session.tUs, vx: 0, vy: 0 });
}

async function click(session: ClientSession, button = 0) {
  session.send({ type: 'button', button, down: true });
  await sleep(40);
  session.send({ type: 'button', button, down: false });
}

async function runScript(session: ClientSession, script: string, seconds: number) {
  out({ type: 'script', name: script });
  switch (script) {
    case 'circle':
      await stream(session, seconds, (t) => [400 * Math.cos(2 * Math.PI * 0.5 * t), 400 * Math.sin(2 * Math.PI * 0.5 * t)]);
      break;
    case 'click':
      await click(session);
      break;
    case 'idle':
      await sleep(seconds * 1000);
      break;
    case 'e2e':
      await stream(session, 0.6, () => [500, 0]);
      await click(session, 0);
      session.send({ type: 'scroll', tUs: session.tUs, dx: 0, dy: 2 });
      session.control({ op: 'key', chord: ['ArrowRight'] });
      session.control({ op: 'key', chord: ['Hyper', 'KeyQ'] }); // must be rejected
      session.control({ op: 'mode', mode: 'present' });
      session.control({ op: 'laser', on: true, style: 'dot' });
      await stream(session, 0.3, () => [300, 300]);
      session.control({ op: 'laser', on: false });
      session.send({ type: 'fling', tUs: session.tUs, vx: 2500, vy: 0 });
      session.send({ type: 'dial', tUs: session.tUs, deltaRad: 0.26, detents: 1 });
      await sleep(1500); // let RTT pings happen
      break;
    default: {
      // demo: a bit of everything, slowly enough to watch.
      await stream(session, Math.min(seconds, 4), (t) => [350 * Math.cos(Math.PI * t), 350 * Math.sin(Math.PI * t)]);
      await click(session);
      session.send({ type: 'scroll', tUs: session.tUs, dx: 0, dy: 3 });
      session.send({ type: 'fling', tUs: session.tUs, vx: 2200, vy: -300 });
      await sleep(1500);
    }
  }
}

async function main() {
  try {
    if (command === 'pair' || command === 'pair-and-run') {
      if (!positional) throw new Error('Usage: pair "<vanepoint://pair?...>"');
      const info = parsePairingUri(positional);
      const state = loadState(flag('fresh-identity'));
      out({ type: 'pairing', hosts: info.hosts.join(','), port: info.port, desktop: info.name });
      const { session, desktop } = await pairWithDesktop({ info, identity: identityOf(state), device, createSocket });
      state.desktop = { ...desktop, publicKey: base64UrlEncode(desktop.publicKey) };
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      out({ type: 'paired', desktop: desktop.name, host: session.host, fingerprint: desktop.fingerprint });
      attach(session);
      if (command === 'pair-and-run') await runScript(session, option('script', 'demo'), Number(option('seconds', '4')));
      else await sleep(300);
      session.close();
    } else if (command === 'run' || command === 'connect') {
      const state = loadState(false);
      const desktop = desktopOf(state);
      const identity = flag('fresh-identity') ? generateKeyPair() : identityOf(state);
      const session = await connectToDesktop({ desktop, identity, device, createSocket });
      out({ type: 'connected', desktop: desktop.name, host: session.host });
      attach(session);
      await runScript(session, command === 'connect' ? 'idle' : option('script', 'demo'), Number(option('seconds', command === 'connect' ? '1' : '4')));
      session.close();
    } else {
      console.error('Commands: pair <uri> | run [--script demo|circle|click|e2e] | pair-and-run <uri> | connect [--fresh-identity]');
      process.exit(2);
    }
    await sleep(100);
    process.exit(0);
  } catch (e) {
    const err = e as SessionError;
    out({ type: 'error', code: err.code ?? null, message: err.message });
    process.exit(1);
  }
}

void main();
