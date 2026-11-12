// Touch handling shared by Trackpad and Trackball: accumulates finger deltas and sends
// velocities at 60 Hz (so a resting finger reads as zero velocity), plus taps and scrolls.
import { touchGain } from '@vanepoint/core';
import { useMemo, useRef } from 'react';
import { PanResponder, type GestureResponderEvent } from 'react-native';

/** Reference pixels per point of finger travel at 1× gain. */
const PX_PER_PT = 1.8;

export interface TouchStreamHandlers {
  onVelocity: (vx: number, vy: number) => void;
  onScroll: (dx: number, dy: number) => void;
  onTap: (fingers: number) => void;
  onStart?: () => void;
  onRelease?: (sample: { t: number; x: number; y: number }[]) => void;
  speed: () => number;
}

export function useTouchStream(h: TouchStreamHandlers) {
  const handlers = useRef(h);
  handlers.current = h;

  return useMemo(() => {
    let acc = { x: 0, y: 0 };
    let scrollAcc = { x: 0, y: 0 };
    let last: { x: number; y: number } | null = null;
    let lastTick = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let startT = 0;
    let travel = 0;
    let maxFingers = 0;
    let fingers = 0;
    let trail: { t: number; x: number; y: number }[] = [];
    let pos = { x: 0, y: 0 };

    const centroid = (e: GestureResponderEvent) => {
      const t = e.nativeEvent.touches;
      if (!t.length) return null;
      let x = 0;
      let y = 0;
      for (const p of t) {
        x += p.pageX;
        y += p.pageY;
      }
      return { x: x / t.length, y: y / t.length };
    };

    const tick = () => {
      const now = Date.now();
      const dt = Math.max(0.001, (now - lastTick) / 1000);
      lastTick = now;
      if (fingers >= 2) {
        if (scrollAcc.x || scrollAcc.y) {
          handlers.current.onScroll(scrollAcc.x / 30, scrollAcc.y / 30);
          scrollAcc = { x: 0, y: 0 };
        }
        handlers.current.onVelocity(0, 0);
        acc = { x: 0, y: 0 };
        return;
      }
      const vxPt = acc.x / dt;
      const vyPt = acc.y / dt;
      const g = touchGain(Math.hypot(vxPt, vyPt)) * PX_PER_PT * handlers.current.speed();
      handlers.current.onVelocity(vxPt * g, vyPt * g);
      acc = { x: 0, y: 0 };
    };

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        last = centroid(e);
        fingers = e.nativeEvent.touches.length;
        maxFingers = fingers;
        startT = Date.now();
        travel = 0;
        acc = { x: 0, y: 0 };
        scrollAcc = { x: 0, y: 0 };
        pos = { x: 0, y: 0 };
        trail = [{ t: startT, x: 0, y: 0 }];
        lastTick = Date.now();
        handlers.current.onStart?.();
        stop();
        timer = setInterval(tick, 16);
      },
      onPanResponderMove: (e) => {
        const n = e.nativeEvent.touches.length;
        const c = centroid(e);
        if (!c) return;
        if (n !== fingers || !last) {
          fingers = n;
          maxFingers = Math.max(maxFingers, n);
          last = c;
          return;
        }
        const dx = c.x - last.x;
        const dy = c.y - last.y;
        last = c;
        travel += Math.hypot(dx, dy);
        if (n >= 2) {
          scrollAcc.x += dx;
          scrollAcc.y += dy;
        } else {
          acc.x += dx;
          acc.y += dy;
          pos = { x: pos.x + dx, y: pos.y + dy };
          trail.push({ t: Date.now(), x: pos.x, y: pos.y });
          if (trail.length > 30) trail.shift();
        }
      },
      onPanResponderRelease: () => {
        tick();
        stop();
        handlers.current.onVelocity(0, 0);
        const dur = Date.now() - startT;
        if (dur < 200 && travel < 10) handlers.current.onTap(maxFingers);
        else handlers.current.onRelease?.(trail);
        fingers = 0;
        last = null;
      },
      onPanResponderTerminate: () => {
        stop();
        handlers.current.onVelocity(0, 0);
        fingers = 0;
        last = null;
      },
    });
  }, []);
}

export { PX_PER_PT };
