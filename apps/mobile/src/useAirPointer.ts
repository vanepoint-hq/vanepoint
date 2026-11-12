// Streams Air Pointer velocities while `active`: gyroscope → pointing frame → 1€ → gain → MOTION.
import { AirPointer } from '@vanepoint/core';
import { useEffect, useRef } from 'react';
import { useConnection } from './connection';
import { subscribeMotion } from './motionSource';

export function useAirPointer(active: boolean) {
  const { send, tUs, settings } = useConnection();
  const pointer = useRef(new AirPointer());

  useEffect(() => {
    pointer.current.opts = { ...pointer.current.opts, speed: settings.speed, invertX: settings.invertX, invertY: settings.invertY };
  }, [settings.speed, settings.invertX, settings.invertY]);

  useEffect(() => {
    if (!active) return;
    let recentered = false;
    const unsubscribe = subscribeMotion((s) => {
      if (!recentered) {
        // Each hold starts a fresh pointing frame (the clutch re-references the grip).
        pointer.current.recenter(s.gravityDown);
        recentered = true;
      }
      const { vx, vy } = pointer.current.process(s.omega, s.gravityDown, s.t);
      send({ type: 'motion', tUs: tUs(), vx, vy });
    });
    return () => {
      unsubscribe();
      send({ type: 'motion', tUs: tUs(), vx: 0, vy: 0 });
    };
  }, [active, send, tUs]);
}
