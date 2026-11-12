import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type AgentEvent, api, type DeviceView, inTauri, onAgentEvent, onUiCommand, type PairingView, type StatusResponse } from './api';
import { Logo } from './Logo';

interface PendingRequest {
  requestId: number;
  deviceName: string;
  platform: string;
  fingerprint: string;
}

interface LogLine {
  t: number;
  level: string;
  message: string;
}

// Browser preview (npm run dev without Tauri) uses sample data so the UI can be designed.
const DEMO: StatusResponse = {
  status: {
    desktopName: 'Studio PC',
    fingerprint: '3fa91c07d2b84e15',
    port: 47800,
    addresses: ['192.168.1.20'],
    devices: [
      { id: 'a1', name: 'Pixel 9', platform: 'android', pairedAt: 1_762_900_000, lastSeen: Date.now() / 1000, connected: true },
      { id: 'b2', name: 'iPad mini', platform: 'ios', pairedAt: 1_762_000_000, lastSeen: Date.now() / 1000 - 86_400 * 2, connected: false },
    ],
    pairing: null,
    profile: 'PowerPoint',
  },
  error: null,
  killSwitch: 'Ctrl+Alt+Shift+Esc',
  platform: 'windows',
};

function relativeTime(unixSeconds: number): string {
  const s = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

function platformLabel(p: string): string {
  return ({ ios: 'iPhone / iPad', android: 'Android', simulator: 'Simulator' } as Record<string, string>)[p] ?? p;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function PairingCard({ pairing, onCancel, onRefresh }: { pairing: PairingView; onCancel: () => void; onRefresh: () => void }) {
  const [svg, setSvg] = useState('');
  const [copied, setCopied] = useState(false);
  const now = useNow(250);
  const total = 120;
  const remaining = Math.max(0, pairing.expiresAt - now / 1000);
  useEffect(() => {
    QRCode.toString(pairing.uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0b12', light: '#ffffff' } }).then(setSvg);
  }, [pairing.uri]);
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return (
    <section className="card pairing" aria-label="Pairing code">
      <div className="pairing-head">
        <div>
          <h2>Pair a phone</h2>
          <p className="muted">Open Vanepoint on your phone and scan this code. Both devices must be on the same network.</p>
        </div>
        <svg className="countdown" viewBox="0 0 36 36" role="img" aria-label={`${Math.ceil(remaining)} seconds left`}>
          <circle cx="18" cy="18" r={r} className="countdown-track" />
          <circle cx="18" cy="18" r={r} className="countdown-bar" strokeDasharray={c} strokeDashoffset={c * (1 - remaining / total)} />
          <text x="18" y="21.5" textAnchor="middle">{Math.ceil(remaining)}</text>
        </svg>
      </div>
      <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="pairing-meta">
        <span>{pairing.addresses.join(' · ')} : {pairing.port}</span>
      </div>
      <div className="row gap">
        <button
          className="btn ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(pairing.uri);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied' : 'Copy code'}
        </button>
        <button className="btn ghost" onClick={onRefresh}>New code</button>
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

function RequestDialog({ req, onAnswer }: { req: PendingRequest; onAnswer: (allow: boolean) => void }) {
  const allowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => allowRef.current?.focus(), []);
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="req-title">
      <div className="dialog">
        <div className="dialog-icon" aria-hidden>📱</div>
        <h2 id="req-title">Allow “{req.deviceName}” to control this computer?</h2>
        <p className="muted">
          {platformLabel(req.platform)} · key <code>{req.fingerprint}</code>
        </p>
        <p className="muted small">It will be able to move the pointer, click and press keys. You can remove it at any time.</p>
        <div className="row gap end">
          <button className="btn" onClick={() => onAnswer(false)}>Deny</button>
          <button className="btn primary" ref={allowRef} onClick={() => onAnswer(true)}>Allow</button>
        </div>
      </div>
    </div>
  );
}

function DeviceRow({ d, rtt, mode, onRevoke }: { d: DeviceView; rtt?: number; mode?: string; onRevoke: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="device">
      <span className={`dot ${d.connected ? 'on' : ''}`} aria-hidden />
      <div className="device-main">
        <div className="device-name">{d.name}</div>
        <div className="muted small">
          {platformLabel(d.platform)} ·{' '}
          {d.connected ? (
            <>
              <span className="ok">Connected</span>
              {rtt !== undefined && <> · {rtt.toFixed(1)} ms</>}
              {mode && <> · {mode}</>}
            </>
          ) : (
            <>last seen {relativeTime(d.lastSeen)}</>
          )}
        </div>
      </div>
      {confirming ? (
        <div className="row gap">
          <button className="btn small" onClick={() => setConfirming(false)}>Keep</button>
          <button className="btn small danger" onClick={onRevoke}>Remove</button>
        </div>
      ) : (
        <button className="btn small ghost" onClick={() => setConfirming(true)} aria-label={`Remove ${d.name}`}>Remove</button>
      )}
    </li>
  );
}

export function App() {
  const [status, setStatus] = useState<StatusResponse | null>(inTauri ? null : DEMO);
  const [pairing, setPairing] = useState<PairingView | null>(null);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [rtt, setRtt] = useState<Record<string, number>>({});
  const [modes, setModes] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [showLog, setShowLog] = useState(false);

  const refresh = useCallback(async () => {
    if (!inTauri) return;
    const s = await api.status();
    setStatus(s);
    setPairing(s.status?.pairing ?? null);
  }, []);

  const openPairing = useCallback(async () => {
    if (!inTauri) {
      setPairing({ uri: 'vanepoint://pair?v=1&k=demo&s=demo&h=192.168.1.20&p=47800&n=Studio%20PC&e=0', expiresAt: Date.now() / 1000 + 120, addresses: ['192.168.1.20'], port: 47800 });
      return;
    }
    setPairing(await api.openPairing());
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    void refresh();
    const subs = [
      onAgentEvent((e: AgentEvent) => {
        switch (e.type) {
          case 'pairingOpened':
            setPairing({ uri: e.uri, expiresAt: e.expiresAt, addresses: e.addresses, port: e.port });
            break;
          case 'pairingClosed':
            setPairing(null);
            break;
          case 'pairingRequest':
            setRequests((r) => [...r, { requestId: e.requestId, deviceName: e.deviceName, platform: e.platform, fingerprint: e.fingerprint }]);
            break;
          case 'pairingResolved':
            setRequests((r) => r.filter((x) => x.requestId !== e.requestId));
            break;
          case 'devicesChanged':
            setStatus((s) => (s?.status ? { ...s, status: { ...s.status, devices: e.devices } } : s));
            break;
          case 'telemetry':
            setRtt((r) => ({ ...r, [e.deviceId]: e.rttMs }));
            break;
          case 'mode':
            setModes((m) => ({ ...m, [e.deviceId]: e.mode }));
            break;
          case 'profile':
            setStatus((s) => (s?.status ? { ...s, status: { ...s.status, profile: e.name } } : s));
            break;
          case 'log':
            setLogs((l) => [...l.slice(-99), { t: Date.now(), level: e.level, message: e.message }]);
            break;
        }
      }),
      onUiCommand((cmd) => {
        if (cmd === 'pair') void openPairing();
      }),
    ];
    return () => {
      subs.forEach((p) => p.then((un) => un()));
    };
  }, [refresh, openPairing]);

  const devices = status?.status?.devices ?? [];
  const connected = useMemo(() => devices.filter((d) => d.connected), [devices]);

  if (!status) {
    return (
      <main className="app center">
        <Logo size={56} />
        <p className="muted">Starting Vanepoint…</p>
      </main>
    );
  }

  if (status.error || !status.status) {
    return (
      <main className="app">
        <header className="header">
          <Logo size={36} />
          <div className="title">
            <h1>Vanepoint</h1>
          </div>
        </header>
        <section className="card error">
          <h2>Vanepoint couldn’t start</h2>
          <p>{status.error}</p>
          <p className="muted small">Another copy of Vanepoint (or vanepoint-headless) may already be using the port. Close it and reopen this app.</p>
        </section>
      </main>
    );
  }

  const s = status.status;
  return (
    <main className="app">
      <header className="header">
        <Logo size={36} />
        <div className="title">
          <h1>Vanepoint</h1>
          <span className="muted small">{s.desktopName}</span>
        </div>
        <span className={`pill ${connected.length ? 'pill-on' : ''}`}>
          <span className="dot" aria-hidden />
          {connected.length ? `${connected.length} connected` : 'Waiting for phone'}
        </span>
      </header>

      {pairing ? (
        <PairingCard
          pairing={pairing}
          onCancel={() => (inTauri ? void api.cancelPairing() : setPairing(null))}
          onRefresh={() => void openPairing()}
        />
      ) : devices.length === 0 ? (
        <section className="card empty">
          <h2>Use your phone as a pointer</h2>
          <p className="muted">Pair your phone once. After that it reconnects automatically whenever both devices are on the same network.</p>
          <button className="btn primary large" onClick={() => void openPairing()}>Pair a phone</button>
        </section>
      ) : null}

      {devices.length > 0 && (
        <section className="card">
          <div className="row">
            <h2>Paired devices</h2>
            <span className="spacer" />
            {!pairing && <button className="btn small" onClick={() => void openPairing()}>+ Pair</button>}
          </div>
          <ul className="devices">
            {devices.map((d) => (
              <DeviceRow key={d.id} d={d} rtt={rtt[d.id]} mode={modes[d.id]} onRevoke={() => (inTauri ? void api.revoke(d.id) : undefined)} />
            ))}
          </ul>
        </section>
      )}

      <section className="card subtle">
        <div className="kv">
          <span className="muted">App profile</span>
          <span>{s.profile ?? 'None (generic controls)'}</span>
        </div>
        <div className="kv">
          <span className="muted">Kill switch</span>
          <span>
            <kbd>{status.killSwitch}</kbd>
          </span>
        </div>
        <div className="kv">
          <span className="muted">Desktop key</span>
          <code>{s.fingerprint}</code>
        </div>
        <div className="kv">
          <span className="muted">Listening on</span>
          <span>
            {s.addresses.join(', ') || 'no network'} : {s.port}
          </span>
        </div>
        {status.platform === 'macos' && (
          <p className="muted small">macOS: allow Vanepoint under System Settings → Privacy & Security → Accessibility, or the pointer won’t move.</p>
        )}
      </section>

      <div className="row gap">
        <button className="btn danger-outline" onClick={() => (inTauri ? void api.killSwitch() : undefined)} disabled={!connected.length}>
          Disconnect all
        </button>
        <span className="spacer" />
        <button className="btn ghost small" onClick={() => setShowLog((v) => !v)}>
          {showLog ? 'Hide activity' : 'Activity'}
        </button>
      </div>

      {showLog && (
        <section className="card log" aria-label="Activity log">
          {logs.length === 0 ? (
            <p className="muted small">Nothing yet.</p>
          ) : (
            logs
              .slice()
              .reverse()
              .map((l) => (
                <div key={l.t + l.message} className={`log-line ${l.level}`}>
                  <span className="muted">{new Date(l.t).toLocaleTimeString()}</span> {l.message}
                </div>
              ))
          )}
        </section>
      )}

      {requests[0] && (
        <RequestDialog
          req={requests[0]}
          onAnswer={(allow) => {
            const id = requests[0].requestId;
            setRequests((r) => r.slice(1));
            if (inTauri) void api.respond(id, allow);
          }}
        />
      )}
    </main>
  );
}
