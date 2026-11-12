// Connection manager: pairing, automatic reconnection, lifecycle and incoming messages.
import {
  type ClientSession,
  CLOSE,
  connectToDesktop,
  type DesktopRecord,
  type DeviceInfo,
  type KeyPair,
  type Message,
  pairWithDesktop,
  parsePairingUri,
  SessionError,
  type WebSocketLike,
} from '@vanepoint/core';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { haptic, hapticFromWire, setHapticsEnabled } from './haptics';
import { isProfile, type Profile } from './profile';
import { DEFAULT_SETTINGS, forgetDesktop, loadDesktop, loadIdentity, loadSettings, saveDesktop, saveSettings, type Settings } from './storage';

export type Status = 'booting' | 'unpaired' | 'connecting' | 'connected' | 'offline';

interface ConnectionValue {
  status: Status;
  message: string | null;
  desktop: DesktopRecord | null;
  rttMs: number | null;
  profile: Profile | null;
  settings: Settings;
  remoteMode: { mode: string; at: number } | null;
  timerResetAt: number;
  updateSettings: (patch: Partial<Settings>) => void;
  pair: (code: string) => Promise<void>;
  reconnect: () => void;
  forget: () => Promise<void>;
  send: (m: Message) => void;
  control: (body: { op: string; [k: string]: unknown }) => void;
  tUs: () => number;
}

const Ctx = createContext<ConnectionValue | null>(null);

export function useConnection(): ConnectionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConnection outside ConnectionProvider');
  return v;
}

const createSocket = (url: string) => new WebSocket(url) as unknown as WebSocketLike;

function deviceInfo(): DeviceInfo {
  return {
    deviceName: Device.deviceName ?? Device.modelName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android phone'),
    platform: Platform.OS,
    appVersion: Application.nativeApplicationVersion ?? '0.1.0',
    capabilities: ['haptics', 'profiles'],
  };
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('booting');
  const [message, setMessage] = useState<string | null>(null);
  const [desktop, setDesktop] = useState<DesktopRecord | null>(null);
  const [rttMs, setRtt] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [remoteMode, setRemoteMode] = useState<{ mode: string; at: number } | null>(null);
  const [timerResetAt, setTimerResetAt] = useState(0);

  const identity = useRef<KeyPair | null>(null);
  const session = useRef<ClientSession | null>(null);
  const desktopRef = useRef<DesktopRecord | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);
  const connecting = useRef(false);
  const active = useRef(true);
  const autoRetry = useRef(true);

  const clearRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };

  const attach = useCallback((s: ClientSession) => {
    session.current = s;
    retryDelay.current = 1000;
    setRtt(null);
    s.onRtt = (ms) => setRtt(ms);
    s.onMessage = (m) => {
      if (m.type === 'haptic') hapticFromWire(m.pattern);
      else if (m.type === 'control') {
        const op = m.body.op;
        if (op === 'profile') setProfile(isProfile(m.body.profile) ? m.body.profile : null);
        else if (op === 'mode' && typeof m.body.mode === 'string') setRemoteMode({ mode: m.body.mode, at: Date.now() });
        else if (op === 'timer_reset') setTimerResetAt(Date.now());
      }
    };
    s.onClose = (code, reason) => {
      if (session.current === s) session.current = null;
      setRtt(null);
      if (code === CLOSE.NOT_TRUSTED || code === CLOSE.REVOKED) {
        void forgetDesktop();
        desktopRef.current = null;
        setDesktop(null);
        setStatus('unpaired');
        setMessage(code === CLOSE.REVOKED ? 'This phone was removed on the desktop. Pair again to continue.' : 'The desktop no longer trusts this phone. Pair again.');
        return;
      }
      if (reason === 'background' || reason === 'user') return;
      haptic('disconnected');
      setStatus('offline');
      if (code === CLOSE.KILLED) {
        setMessage('The desktop disconnected all devices (kill switch). Tap Reconnect when ready.');
        autoRetry.current = false;
        return;
      }
      setMessage('Connection lost. Reconnecting…');
      scheduleRetry();
    };
    setStatus('connected');
    setMessage(null);
    s.control({ op: 'hello', protocol: 1, capabilities: ['haptics', 'profiles'] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async () => {
    const d = desktopRef.current;
    if (!d || !identity.current || connecting.current || session.current || !active.current) return;
    connecting.current = true;
    clearRetry();
    setStatus('connecting');
    try {
      const s = await connectToDesktop({ desktop: d, identity: identity.current, device: deviceInfo(), createSocket });
      if (!active.current) {
        s.close('background');
        return;
      }
      // Remember which address worked first next time.
      desktopRef.current = s.desktop;
      void saveDesktop(s.desktop);
      attach(s);
    } catch (e) {
      const err = e as SessionError;
      if (err.code === CLOSE.NOT_TRUSTED) {
        await forgetDesktop();
        desktopRef.current = null;
        setDesktop(null);
        setStatus('unpaired');
        setMessage(err.message);
      } else {
        setStatus('offline');
        setMessage(`Can’t reach ${d.name}. Check that both devices are on the same Wi-Fi and Vanepoint is running.`);
        scheduleRetry();
      }
    } finally {
      connecting.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attach]);

  const scheduleRetry = useCallback(() => {
    if (!autoRetry.current || !active.current || !desktopRef.current) return;
    clearRetry();
    retryTimer.current = setTimeout(() => void connect(), retryDelay.current);
    retryDelay.current = Math.min(retryDelay.current * 2, 10_000);
  }, [connect]);

  useEffect(() => {
    (async () => {
      identity.current = await loadIdentity();
      const s = await loadSettings();
      setSettings(s);
      setHapticsEnabled(s.haptics);
      const d = await loadDesktop();
      desktopRef.current = d;
      setDesktop(d);
      if (d) void connect();
      else setStatus('unpaired');
    })();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        active.current = true;
        autoRetry.current = true;
        void connect();
      } else if (st === 'background') {
        active.current = false;
        clearRetry();
        session.current?.close('background');
        session.current = null;
        if (desktopRef.current) setStatus('offline');
      }
    });
    return () => {
      sub.remove();
      clearRetry();
      session.current?.close('user');
    };
  }, [connect]);

  const pair = useCallback(
    async (code: string) => {
      if (!identity.current) identity.current = await loadIdentity();
      const info = parsePairingUri(code);
      session.current?.close('user');
      session.current = null;
      const { session: s, desktop: d } = await pairWithDesktop({ info, identity: identity.current, device: deviceInfo(), createSocket });
      await saveDesktop(d);
      desktopRef.current = d;
      setDesktop(d);
      autoRetry.current = true;
      haptic('success');
      attach(s);
    },
    [attach],
  );

  const forget = useCallback(async () => {
    clearRetry();
    session.current?.close('user');
    session.current = null;
    await forgetDesktop();
    desktopRef.current = null;
    setDesktop(null);
    setProfile(null);
    setStatus('unpaired');
    setMessage(null);
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      setHapticsEnabled(next.haptics);
      void saveSettings(next);
      return next;
    });
  }, []);

  const value = useMemo<ConnectionValue>(
    () => ({
      status,
      message,
      desktop,
      rttMs,
      profile,
      settings,
      remoteMode,
      timerResetAt,
      updateSettings,
      pair,
      reconnect: () => {
        autoRetry.current = true;
        retryDelay.current = 1000;
        void connect();
      },
      forget,
      send: (m) => session.current?.send(m),
      control: (body) => session.current?.control(body),
      tUs: () => session.current?.tUs ?? 0,
    }),
    [status, message, desktop, rttMs, profile, settings, remoteMode, timerResetAt, updateSettings, pair, connect, forget],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { SessionError };
