// Motion processing for the phone: 1€ filter, gravity-referenced pointing frame,
// pointer acceleration, release-velocity estimation and dial tracking (paper §V–VI).

export type Vec3 = [number, number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a);
  return n > 1e-9 ? scale(a, 1 / n) : [0, 0, 0];
};

// ------------------------------------------------------------------ 1€ filter
function smoothingFactor(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

/** Casiez, Roussel & Vogel (CHI 2012). Timestamps in seconds. */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    public minCutoff = 0.8,
    public beta = 0.45,
    public dCutoff = 1.0,
  ) {}

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
  }

  filter(x: number, t: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(1e-4, t - this.tPrev);
    this.tPrev = t;
    const dx = (x - this.xPrev) / dt;
    const aD = smoothingFactor(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = smoothingFactor(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }
}

// ------------------------------------------------------------------ pointing frame
/**
 * Roll-invariant pointing frame. `gravityDown` is the unit gravity direction in device
 * coordinates (pointing towards the ground). The forward axis is chosen at recenter: the
 * phone's top edge when held like a remote, or the back of the phone when held upright.
 */
export class PointingFrame {
  private forward: Vec3 = [0, 1, 0];
  private lastRight: Vec3 = [1, 0, 0];

  capture(gravityDown: Vec3): void {
    const g = normalize(gravityDown);
    const candidates: Vec3[] = [
      [0, 1, 0], // top edge
      [0, 0, -1], // back of the phone
    ];
    let best = candidates[0];
    let bestHorizontal = -1;
    for (const c of candidates) {
      const horizontal = norm(sub(c, scale(g, dot(c, g))));
      if (horizontal > bestHorizontal) {
        bestHorizontal = horizontal;
        best = c;
      }
    }
    this.forward = best;
    this.lastRight = normalize(cross(g, best));
  }

  /** Angular rates (rad/s) about the world vertical and the horizontal pitch axis. */
  project(omega: Vec3, gravityDown: Vec3): { yaw: number; pitch: number } {
    const g = normalize(gravityDown);
    // Positive `yaw` = turning right (clockwise seen from above) → cursor moves right.
    const yaw = dot(omega, g);
    const r = cross(g, this.forward);
    if (norm(r) >= 0.2) this.lastRight = normalize(r);
    // Positive `pitch` = pointing up → cursor moves up (screen y decreases).
    const pitch = dot(omega, this.lastRight);
    return { yaw, pitch };
  }
}

// ------------------------------------------------------------------ transfer functions
export interface GainParams {
  gMin: number;
  gMax: number;
  s0: number;
  width: number;
}

export const DEFAULT_GAIN: GainParams = { gMin: 0.35, gMax: 2.4, s0: 1.1, width: 0.3 };

/** Sigmoid pointer acceleration G(s). */
export function gain(s: number, p: GainParams = DEFAULT_GAIN): number {
  return p.gMin + (p.gMax - p.gMin) / (1 + Math.exp(-(s - p.s0) / p.width));
}

/** Smooth dead zone: scales magnitudes below `threshold` by (|v|/threshold)². */
export function deadZoneScale(magnitude: number, threshold: number): number {
  if (magnitude >= threshold || threshold <= 0) return 1;
  const r = magnitude / threshold;
  return r * r;
}

export interface AirPointerOptions {
  /** Reference pixels per radian at G = 1. */
  pixelsPerRadian: number;
  speed: number;
  invertX: boolean;
  invertY: boolean;
  deadZone: number;
  gain: GainParams;
  minCutoff: number;
  beta: number;
}

export const DEFAULT_AIR: AirPointerOptions = {
  pixelsPerRadian: 1000,
  speed: 1,
  invertX: false,
  invertY: false,
  deadZone: 0.02,
  gain: DEFAULT_GAIN,
  minCutoff: 0.8,
  beta: 0.45,
};

/** Full Air Pointer pipeline: projection → 1€ → dead zone → gain → px/s. */
export class AirPointer {
  readonly frame = new PointingFrame();
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;
  opts: AirPointerOptions;

  constructor(opts: Partial<AirPointerOptions> = {}) {
    this.opts = { ...DEFAULT_AIR, ...opts };
    this.fx = new OneEuroFilter(this.opts.minCutoff, this.opts.beta);
    this.fy = new OneEuroFilter(this.opts.minCutoff, this.opts.beta);
  }

  recenter(gravityDown: Vec3): void {
    this.frame.capture(gravityDown);
    this.fx.reset();
    this.fy.reset();
  }

  /** omega in rad/s (device frame), gravityDown in device frame, t in seconds. Returns px/s. */
  process(omega: Vec3, gravityDown: Vec3, t: number): { vx: number; vy: number } {
    const { yaw, pitch } = this.frame.project(omega, gravityDown);
    const wx = this.fx.filter(yaw, t);
    const wy = this.fy.filter(pitch, t);
    const s = Math.hypot(wx, wy);
    const k = this.opts.pixelsPerRadian * this.opts.speed * gain(s, this.opts.gain) * deadZoneScale(s, this.opts.deadZone);
    return {
      vx: (this.opts.invertX ? -1 : 1) * k * wx,
      vy: (this.opts.invertY ? 1 : -1) * k * wy,
    };
  }
}

/** Touch acceleration for the trackpad: ~1× when slow, up to `max`× when fast (speed in pt/s). */
export function touchGain(speedPtPerSec: number, max = 2.6): number {
  return 1 + (max - 1) / (1 + Math.exp(-(speedPtPerSec - 900) / 250));
}

// ------------------------------------------------------------------ release velocity
/** Least-squares velocity over the most recent window of touch samples (paper Eq. 4). */
export class ReleaseVelocityEstimator {
  private samples: { t: number; x: number; y: number }[] = [];

  constructor(private windowMs = 80) {}

  reset(): void {
    this.samples = [];
  }

  add(tMs: number, x: number, y: number): void {
    this.samples.push({ t: tMs, x, y });
    const cutoff = tMs - this.windowMs * 2;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }

  /** Velocity in units per second over the last `windowMs`. */
  estimate(nowMs?: number): { vx: number; vy: number } {
    if (this.samples.length < 2) return { vx: 0, vy: 0 };
    const end = nowMs ?? this.samples[this.samples.length - 1].t;
    const pts = this.samples.filter((s) => s.t >= end - this.windowMs);
    if (pts.length < 2) return { vx: 0, vy: 0 };
    // Finger stopped before release → no fling.
    if (end - pts[pts.length - 1].t > 50) return { vx: 0, vy: 0 };
    const n = pts.length;
    const tm = pts.reduce((a, p) => a + p.t, 0) / n;
    const xm = pts.reduce((a, p) => a + p.x, 0) / n;
    const ym = pts.reduce((a, p) => a + p.y, 0) / n;
    let stt = 0;
    let stx = 0;
    let sty = 0;
    for (const p of pts) {
      const dt = p.t - tm;
      stt += dt * dt;
      stx += dt * (p.x - xm);
      sty += dt * (p.y - ym);
    }
    if (stt < 1e-6) return { vx: 0, vy: 0 };
    return { vx: (stx / stt) * 1000, vy: (sty / stt) * 1000 };
  }
}

// ------------------------------------------------------------------ dial
export function wrapAngle(a: number): number {
  let x = a;
  while (x <= -Math.PI) x += 2 * Math.PI;
  while (x > Math.PI) x -= 2 * Math.PI;
  return x;
}

/** Accumulates rotation and reports whole detents crossed (paper Eqs. 6–7). */
export class DialTracker {
  private last: number | null = null;
  private accumulated = 0;
  private emitted = 0;

  constructor(public detentsPerTurn = 24) {}

  reset(): void {
    this.last = null;
  }

  /** Feed an absolute angle (rad). Returns the rotation delta and detents crossed since the last call. */
  update(angle: number): { delta: number; detents: number } {
    if (this.last === null) {
      this.last = angle;
      return { delta: 0, detents: 0 };
    }
    const delta = wrapAngle(angle - this.last);
    this.last = angle;
    this.accumulated += delta;
    const total = Math.floor((this.accumulated * this.detentsPerTurn) / (2 * Math.PI));
    const detents = total - this.emitted;
    this.emitted = total;
    return { delta, detents };
  }

  get rotation(): number {
    return this.accumulated;
  }
}
