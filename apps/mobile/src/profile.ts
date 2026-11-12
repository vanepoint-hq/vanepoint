// App profiles as received from the desktop (see profiles/schema/profile.schema.json).

export interface ButtonControl {
  type: 'button';
  label: string;
  icon?: string;
  action: string;
  haptic?: string;
  span?: number;
  emphasis?: 'primary' | 'secondary' | 'danger';
}

export interface DialControl {
  type: 'dial';
  label: string;
  cw: string;
  ccw: string;
  detentsPerTurn?: number;
  accelerate?: boolean;
}

export interface SwipeControl {
  type: 'swipe';
  left?: string;
  right?: string;
  up?: string;
  down?: string;
}

export type Control = ButtonControl | DialControl | SwipeControl;

export interface Surface {
  mode: 'present' | 'buttons' | 'dial' | 'trackpad' | 'air' | 'trackball';
  title?: string;
  controls: Control[];
}

export interface Profile {
  id: string;
  name: string;
  actions: Record<string, { kind: string; confirm?: boolean }>;
  surfaces: Surface[];
}

/** ACTION ids are the index of the action in the profile's `actions` object. */
export function actionIndex(p: Profile | null, name: string | undefined): number | null {
  if (!p || !name) return null;
  const i = Object.keys(p.actions).indexOf(name);
  return i >= 0 ? i : null;
}

export function needsConfirm(p: Profile | null, name: string): boolean {
  return !!p?.actions[name]?.confirm;
}

export function surfacesOf(p: Profile | null, mode: Surface['mode']): Surface[] {
  return p?.surfaces.filter((s) => s.mode === mode) ?? [];
}

export function isProfile(x: unknown): x is Profile {
  const p = x as Profile;
  return !!p && typeof p.id === 'string' && typeof p.actions === 'object' && Array.isArray(p.surfaces);
}
