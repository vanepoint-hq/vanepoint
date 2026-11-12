import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface DeviceView {
  id: string;
  name: string;
  platform: string;
  pairedAt: number;
  lastSeen: number;
  connected: boolean;
}

export interface PairingView {
  uri: string;
  expiresAt: number;
  addresses: string[];
  port: number;
}

export interface StatusView {
  desktopName: string;
  fingerprint: string;
  port: number;
  addresses: string[];
  devices: DeviceView[];
  pairing: PairingView | null;
  profile: string | null;
}

export interface StatusResponse {
  status: StatusView | null;
  error: string | null;
  killSwitch: string;
  platform: string;
}

export type AgentEvent =
  | { type: 'ready'; port: number; addresses: string[]; fingerprint: string; desktopName: string }
  | { type: 'pairingOpened'; uri: string; expiresAt: number; addresses: string[]; port: number }
  | { type: 'pairingClosed'; reason: string }
  | { type: 'pairingRequest'; requestId: number; deviceName: string; platform: string; fingerprint: string }
  | { type: 'pairingResolved'; requestId: number; allowed: boolean }
  | { type: 'devicesChanged'; devices: DeviceView[] }
  | { type: 'deviceConnected'; deviceId: string; name: string; address: string }
  | { type: 'deviceDisconnected'; deviceId: string; name: string; reason: string }
  | { type: 'telemetry'; deviceId: string; rttMs: number }
  | { type: 'mode'; deviceId: string; mode: string }
  | { type: 'profile'; id: string | null; name: string | null }
  | { type: 'edge' }
  | { type: 'log'; level: string; message: string };

export const api = {
  status: () => invoke<StatusResponse>('get_status'),
  openPairing: () => invoke<PairingView>('open_pairing'),
  cancelPairing: () => invoke<void>('cancel_pairing'),
  respond: (requestId: number, allow: boolean) => invoke<boolean>('respond_pairing', { requestId, allow }),
  revoke: (deviceId: string) => invoke<boolean>('revoke_device', { deviceId }),
  killSwitch: () => invoke<void>('kill_switch'),
};

export function onAgentEvent(handler: (e: AgentEvent) => void): Promise<UnlistenFn> {
  return listen<AgentEvent>('agent-event', (ev) => handler(ev.payload));
}

export function onUiCommand(handler: (cmd: string) => void): Promise<UnlistenFn> {
  return listen<string>('ui-command', (ev) => handler(ev.payload));
}

/** True when running inside Tauri (false in a plain browser preview). */
export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
