// Present: one giant Next target, swipe right for Previous, hold Laser to point, talk timer.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { useConnection } from '../connection';
import { haptic } from '../haptics';
import { actionIndex, type ButtonControl, surfacesOf } from '../profile';
import { colors, radius, space, type } from '../theme';
import { Button } from '../ui';
import { useAirPointer } from '../useAirPointer';

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function PresentSurface() {
  const { send, control, profile, timerResetAt, settings } = useConnection();
  const [laser, setLaser] = useState<null | 'dot' | 'spotlight'>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedBefore, setElapsedBefore] = useState(0);
  const [, force] = useState(0);
  useAirPointer(laser !== null);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (timerResetAt) {
      setStartedAt(null);
      setElapsedBefore(0);
    }
  }, [timerResetAt]);

  const presentControls = surfacesOf(profile, 'present').flatMap((s) => s.controls);
  const nextName = presentControls.find((c): c is ButtonControl => c.type === 'button' && c.emphasis === 'primary')?.action ?? 'next';
  const prevName = profile?.actions.previous ? 'previous' : undefined;
  const ctx = useRef({ profile, nextName, prevName, send, control });
  ctx.current = { profile, nextName, prevName, send, control };

  const go = (dir: 1 | -1) => {
    const { profile: p, nextName: n, prevName: pv, send: s, control: c } = ctx.current;
    const id = actionIndex(p, dir > 0 ? n : pv);
    if (id !== null) s({ type: 'action', id });
    else c({ op: 'key', chord: [dir > 0 ? 'ArrowRight' : 'ArrowLeft'] });
    haptic('click');
    if (dir > 0) setStartedAt((t) => t ?? Date.now());
  };

  const swipe = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) > 60 && Math.abs(g.dx) > Math.abs(g.dy)) go(g.dx > 0 ? -1 : 1);
          else if (Math.abs(g.dx) < 12 && Math.abs(g.dy) < 12) go(1);
        },
      }),
    [],
  );

  const setLaserOn = (style: 'dot' | 'spotlight' | null) => {
    setLaser(style);
    control({ op: 'laser', on: style !== null, style: style ?? 'dot' });
    if (style) haptic('click');
  };

  const elapsed = elapsedBefore + (startedAt ? Date.now() - startedAt : 0);

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Text
          style={styles.timer}
          accessibilityRole="button"
          accessibilityLabel={`Talk timer ${fmt(elapsed)}. Tap to ${startedAt ? 'pause' : 'start'}, long press to reset`}
          onPress={() => {
            if (startedAt) {
              setElapsedBefore(elapsed);
              setStartedAt(null);
            } else setStartedAt(Date.now());
          }}
          onLongPress={() => {
            setStartedAt(null);
            setElapsedBefore(0);
            haptic('warning');
          }}
        >
          {fmt(elapsed)}
        </Text>
        <Text style={styles.micro}>{profile ? profile.name : 'ARROW KEYS'}</Text>
      </View>
      <View style={[styles.next, laser && styles.nextDim]} {...swipe.panHandlers} accessibilityRole="button" accessibilityLabel="Next slide" accessibilityHint="Swipe right for the previous slide">
        <Text style={styles.nextText}>NEXT</Text>
        <Text style={styles.arrow}>→</Text>
        <Text style={styles.hint}>tap for next · swipe right for previous</Text>
      </View>
      <View style={[styles.row, settings.leftHanded && { flexDirection: 'row-reverse' }]}>
        <Button label="◀ Prev" style={styles.btn} onPress={() => go(-1)} />
        <Button
          label={laser === 'spotlight' ? 'Spotlight' : 'Laser'}
          variant={laser ? 'primary' : 'secondary'}
          style={styles.btn}
          onPressIn={() => setLaserOn('dot')}
          onPressOut={() => setLaserOn(null)}
          accessibilityHint="Hold and move the phone to point at the screen"
        />
        <Button label="Spot" style={styles.btnSmall} onPressIn={() => setLaserOn('spotlight')} onPressOut={() => setLaserOn(null)} accessibilityHint="Hold to spotlight an area" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space(4), gap: space(3) },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timer: { ...type.display, color: colors.text, fontVariant: ['tabular-nums'] },
  micro: { ...type.micro, color: colors.brandText, textTransform: 'uppercase' },
  next: { flex: 1, minHeight: '60%', borderRadius: radius.xl, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', gap: space(1) },
  nextDim: { opacity: 0.55 },
  nextText: { color: '#fff', fontSize: 40, fontWeight: '700', letterSpacing: 2 },
  arrow: { color: '#fff', fontSize: 44 },
  hint: { ...type.caption, color: 'rgba(255,255,255,0.75)', marginTop: space(2) },
  row: { flexDirection: 'row', gap: space(3), minHeight: 72 },
  btn: { flex: 1, minHeight: 72, borderRadius: radius.lg },
  btnSmall: { width: 80, minHeight: 72, borderRadius: radius.lg },
});
