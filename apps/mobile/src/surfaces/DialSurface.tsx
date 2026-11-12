// Rotary Dial: one finger around the ring or two-finger twist; a haptic tick per detent.
// With an app profile the detents run the profile's cw/ccw actions; otherwise they scroll.
import { DialTracker } from '@vanepoint/core';
import { useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useConnection } from '../connection';
import { haptic } from '../haptics';
import { actionIndex, type DialControl, surfacesOf } from '../profile';
import { colors, space, type } from '../theme';

export function DialSurface() {
  const { send, tUs, profile } = useConnection();
  const dialSurfaces = surfacesOf(profile, 'dial');
  const [which, setWhich] = useState(0);
  const surface = dialSurfaces[which] ?? dialSurfaces[0];
  const control = surface?.controls.find((c): c is DialControl => c.type === 'dial');
  const detentsPerTurn = control?.detentsPerTurn ?? 24;
  const [count, setCount] = useState(0);
  const [angle, setAngle] = useState(0);
  const center = useRef({ x: 0, y: 0 });
  const tracker = useRef(new DialTracker(detentsPerTurn));
  tracker.current.detentsPerTurn = detentsPerTurn;
  const ctx = useRef({ control, profile, send, tUs });
  ctx.current = { control, profile, send, tUs };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    center.current = { x: width / 2, y: height / 2 };
  };

  const responder = useMemo(() => {
    const angleOf = (touches: readonly { locationX: number; locationY: number }[]) => {
      if (touches.length >= 2) return Math.atan2(touches[1].locationY - touches[0].locationY, touches[1].locationX - touches[0].locationX);
      return Math.atan2(touches[0].locationY - center.current.y, touches[0].locationX - center.current.x);
    };
    let fingers = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        fingers = e.nativeEvent.touches.length;
        tracker.current.reset();
        tracker.current.update(angleOf(e.nativeEvent.touches));
      },
      onPanResponderMove: (e) => {
        const t = e.nativeEvent.touches;
        if (!t.length) return;
        if (t.length !== fingers) {
          fingers = t.length;
          tracker.current.reset();
        }
        const { delta, detents } = tracker.current.update(angleOf(t));
        if (delta) setAngle((a) => a + delta);
        if (!detents) return;
        const { control: c, profile: p, send: s, tUs: now } = ctx.current;
        setCount((n) => n + detents);
        for (let i = 0; i < Math.abs(detents); i++) haptic('detent');
        s({ type: 'dial', tUs: now(), deltaRad: delta, detents });
        const id = actionIndex(p, detents > 0 ? c?.cw : c?.ccw);
        if (id !== null) for (let i = 0; i < Math.min(Math.abs(detents), 8); i++) s({ type: 'action', id });
        else s({ type: 'scroll', tUs: now(), dx: 0, dy: detents });
      },
      onPanResponderRelease: () => tracker.current.reset(),
    });
  }, []);

  const ticks = Array.from({ length: detentsPerTurn }, (_, i) => (i / detentsPerTurn) * 2 * Math.PI);
  const knob = { x: 150 + 104 * Math.cos(angle - Math.PI / 2), y: 150 + 104 * Math.sin(angle - Math.PI / 2) };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.micro}>{control ? `${profile?.name ?? ''} · ${control.label}` : 'SCROLL'}</Text>
        {dialSurfaces.length > 1 && (
          <Text style={styles.switch} onPress={() => setWhich((w) => (w + 1) % dialSurfaces.length)} accessibilityRole="button">
            {surface?.title ?? 'Next dial'} ⇄
          </Text>
        )}
      </View>
      <View style={styles.dialArea} onLayout={onLayout} {...responder.panHandlers} accessibilityLabel="Dial" accessibilityHint="Rotate with one finger around the ring or twist with two fingers">
        <Svg width="100%" height="100%" viewBox="0 0 300 300">
          <Circle cx="150" cy="150" r="104" stroke={colors.raised} strokeWidth={22} fill="none" />
          {ticks.map((a, i) => (
            <Line
              key={i}
              x1={150 + 126 * Math.cos(a)}
              y1={150 + 126 * Math.sin(a)}
              x2={150 + (i % 6 === 0 ? 138 : 132) * Math.cos(a)}
              y2={150 + (i % 6 === 0 ? 138 : 132) * Math.sin(a)}
              stroke={i % 6 === 0 ? colors.muted : colors.border}
              strokeWidth={2}
            />
          ))}
          <Circle cx={knob.x} cy={knob.y} r={14} fill="#fff" />
        </Svg>
        <View style={styles.centerLabel} pointerEvents="none">
          <Text style={styles.value}>{count > 0 ? `+${count}` : count}</Text>
          <Text style={styles.caption}>{detentsPerTurn} detents / turn</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space(4) },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  micro: { ...type.micro, color: colors.brandText, textTransform: 'uppercase' },
  switch: { ...type.caption, color: colors.brandText, padding: space(2) },
  dialArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerLabel: { position: 'absolute', alignItems: 'center' },
  value: { ...type.display, color: colors.text, fontVariant: ['tabular-nums'] },
  caption: { ...type.caption, color: colors.muted },
});
