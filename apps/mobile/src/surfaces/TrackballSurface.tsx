// Inertia Trackball: drag to move, flick to glide (desktop integrates friction), touch to stop.
import { ReleaseVelocityEstimator } from '@vanepoint/core';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useConnection } from '../connection';
import { haptic } from '../haptics';
import { colors, space, type } from '../theme';
import { Button } from '../ui';
import { PX_PER_PT, useTouchStream } from '../useTouchStream';

const FLING_GAIN = 2.2;

export function TrackballSurface() {
  const { send, tUs, settings } = useConnection();
  const [spin, setSpin] = useState(0);
  const estimator = useRef(new ReleaseVelocityEstimator(80));

  const responder = useTouchStream({
    speed: () => settings.speed,
    onStart: () => {
      // Touching the ball stops any glide in progress.
      send({ type: 'fling', tUs: tUs(), vx: 0, vy: 0 });
    },
    onVelocity: (vx, vy) => {
      send({ type: 'motion', tUs: tUs(), vx, vy });
      if (vx || vy) setSpin((s) => (s + (vx + vy) / 400) % 360);
    },
    onScroll: () => {},
    onTap: () => {
      send({ type: 'button', button: 0, down: true });
      send({ type: 'button', button: 0, down: false });
      haptic('click');
    },
    onRelease: (trail) => {
      estimator.current.reset();
      for (const p of trail) estimator.current.add(p.t, p.x, p.y);
      const v = estimator.current.estimate(Date.now());
      const k = PX_PER_PT * FLING_GAIN * settings.speed;
      if (Math.hypot(v.vx, v.vy) > 150) send({ type: 'fling', tUs: tUs(), vx: v.vx * k, vy: v.vy * k });
    },
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.ballArea} {...responder.panHandlers} accessibilityLabel="Trackball" accessibilityHint="Flick to glide the pointer; touch to stop">
        <Svg width="100%" height="100%" viewBox="0 0 300 300" style={{ transform: [{ rotate: `${spin}deg` }] }}>
          <Defs>
            <RadialGradient id="ball" cx="38%" cy="32%" r="70%">
              <Stop offset="0" stopColor="#8E7BE0" />
              <Stop offset="0.55" stopColor="#4C36B0" />
              <Stop offset="1" stopColor="#1C1440" />
            </RadialGradient>
          </Defs>
          <Circle cx="150" cy="150" r="138" fill="url(#ball)" />
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <Circle key={a} cx={150 + 80 * Math.cos((a * Math.PI) / 180)} cy={150 + 80 * Math.sin((a * Math.PI) / 180)} r="6" fill="rgba(255,255,255,0.22)" />
          ))}
          <Circle cx="110" cy="100" r="26" fill="rgba(255,255,255,0.18)" />
        </Svg>
      </View>
      <Text style={styles.hint}>Flick to glide across screens · touch to stop · tap to click</Text>
      <View style={styles.row}>
        <Button label="Click" style={styles.btn} onPressIn={() => send({ type: 'button', button: 0, down: true })} onPressOut={() => send({ type: 'button', button: 0, down: false })} />
        <Button label="Right" style={styles.btn} onPressIn={() => send({ type: 'button', button: 1, down: true })} onPressOut={() => send({ type: 'button', button: 1, down: false })} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space(4), gap: space(3), alignItems: 'stretch' },
  ballArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { ...type.caption, color: colors.muted, textAlign: 'center' },
  row: { flexDirection: 'row', gap: space(3) },
  btn: { flex: 1, minHeight: 64, borderRadius: 20 },
});
