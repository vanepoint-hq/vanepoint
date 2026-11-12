#!/usr/bin/env node
// End-to-end test: the real Rust agent (dry-run, so your cursor is never moved) against the
// TypeScript phone simulator. Verifies pairing (Noise IKpsk1), encrypted input, the key
// allow-list, laser routing, reconnection (Noise IK) and rejection of unknown phones.
//
//   npm run e2e
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const isWin = process.platform === 'win32';
const cargo = process.env.CARGO ?? 'cargo';
const exe = join(root, 'target', 'debug', isWin ? 'vanepoint-headless.exe' : 'vanepoint-headless');
const tmp = mkdtempSync(join(tmpdir(), 'vanepoint-e2e-'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('Building vanepoint-headless…');
const build = spawnSync(cargo, ['build', '-q', '-p', 'vanepoint-agent', '--bin', 'vanepoint-headless'], { cwd: root, stdio: 'inherit', shell: isWin });
if (build.status !== 0) process.exit(build.status ?? 1);

const agent = spawn(exe, ['--port', '0', '--dry-run', '--auto-approve', '--pair', '--json', '--no-focus', '--host', '127.0.0.1', '--name', 'E2E Desktop', '--data-dir', join(tmp, 'agent')], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
const events = [];
let uri = null;
const waiters = [];
createInterface({ input: agent.stdout }).on('line', (line) => {
  try {
    const e = JSON.parse(line);
    events.push(e);
    if (e.type === 'pairingOpened') uri = e.uri;
    for (const w of waiters.splice(0)) w();
  } catch {
    /* non-JSON */
  }
});
let agentLog = '';
agent.stderr.on('data', (d) => (agentLog += d));

const waitFor = (pred, ms) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    const tick = () => (pred() ? (clearTimeout(t), res()) : waiters.push(tick));
    tick();
  });

function sim(args) {
  // Run tsx through Node directly (no shell), so the `&`s in the pairing URI survive on Windows.
  const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const r = spawnSync(process.execPath, [tsx, 'tools/simulator/src/cli.ts', ...args, '--json', '--state', join(tmp, 'sim.json')], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  const lines = (r.stdout ?? '').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { status: r.status, lines, stderr: r.stderr };
}

const input = () => events.filter((e) => e.type === 'input').map((e) => e.event);

try {
  await waitFor(() => uri, 30_000);
  check('agent started and opened a pairing window', !!uri);

  const p = sim(['pair-and-run', uri, '--script', 'e2e']);
  const paired = p.lines.find((l) => l.type === 'paired');
  check('phone paired with Noise IKpsk1', p.status === 0 && !!paired, paired ? `${paired.desktop} via ${paired.host}` : (p.lines.find((l) => l.type === 'error')?.message ?? p.stderr).slice(0, 400));
  if (!paired) console.error(`--- agent log ---\n${agentLog.slice(-1500)}`);
  await new Promise((r) => setTimeout(r, 600));

  const ev = input();
  const moves = ev.filter((e) => e.kind === 'move');
  check('encrypted MOTION became cursor movement', moves.length > 20, `${moves.length} move events`);
  const rightward = moves.length > 1 && moves[Math.min(moves.length - 1, 20)].x > moves[0].x;
  check('velocity integrates in the right direction', rightward);
  check('left click delivered', ev.some((e) => e.kind === 'button' && e.button === 'left' && e.down) && ev.some((e) => e.kind === 'button' && e.button === 'left' && !e.down));
  check('scroll delivered', ev.some((e) => e.kind === 'scroll' && e.dy === 2));
  check('allowed key chord delivered', ev.some((e) => e.kind === 'key' && e.code === 'ArrowRight'));
  check('unknown keys rejected by the allow-list', !ev.some((e) => e.kind === 'key' && (e.code === 'Hyper' || e.code === 'KeyQ')));
  check('laser motion routed to the overlay, not the cursor', events.some((e) => e.type === 'laser' && e.active));
  check('connected haptic sent to the phone', p.lines.some((l) => l.type === 'haptic' && l.pattern === 4));
  check('round-trip time measured', p.lines.some((l) => l.type === 'rtt') && events.some((e) => e.type === 'telemetry'));
  check('dial event surfaced for the HUD', events.some((e) => e.type === 'dial' && e.detents === 1));

  const before = input().filter((e) => e.kind === 'button').length;
  const r = sim(['run', '--script', 'click']);
  await new Promise((res) => setTimeout(res, 400));
  check('reconnect with Noise IK (no QR needed)', r.status === 0 && r.lines.some((l) => l.type === 'connected'));
  check('input after reconnect', input().filter((e) => e.kind === 'button').length > before);

  const u = sim(['connect', '--fresh-identity']);
  check('unknown phone rejected', u.status !== 0 && u.lines.some((l) => l.type === 'error' && l.code === 4003), u.lines.find((l) => l.type === 'error')?.message?.split('\n')[0]);

  const stale = sim(['pair', uri]);
  check('used pairing code cannot be replayed', stale.status !== 0, stale.lines.find((l) => l.type === 'error')?.message?.split('\n')[0]);
} catch (e) {
  check('e2e run completed', false, String(e));
  console.error(agentLog.slice(-2000));
} finally {
  agent.kill();
  setTimeout(() => rmSync(tmp, { recursive: true, force: true }), 300);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
