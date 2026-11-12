// Trackpad: one finger moves, tap clicks, two-finger tap right-clicks, two-finger drag scrolls.
import { StyleSheet, Text, View } from 'react-native';
import { useConnection } from '../connection';
import { haptic } from '../haptics';
import { colors, radius, space, type } from '../theme';
import { Button } from '../ui';
import { useTouchStream } from '../useTouchStream';

export function TrackpadSurface() {
  const { send, tUs, settings } = useConnection();

  const responder = useTouchStream({
    speed: () => settings.speed,
    onVelocity: (vx, vy) => send({ type: 'motion', tUs: tUs(), vx, vy }),
    onScroll: (dx, dy) => {
      const k = settings.naturalScroll ? -1 : 1;
      send({ type: 'scroll', tUs: tUs(), dx: dx * k, dy: dy * k });
    },
    onTap: (fingers) => {
      const button = fingers >= 2 ? 1 : 0;
      send({ type: 'button', button, down: true });
      send({ type: 'button', button, down: false });
      haptic(button ? 'click_strong' : 'click');
    },
  });

  const press = (button: number, down: boolean) => {
    send({ type: 'button', button, down });
    if (down) haptic(button ? 'click_strong' : 'click');
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.pad} {...responder.panHandlers} accessibilityLabel="Trackpad" accessibilityHint="Drag to move, tap to click, two fingers to scroll">
        <Text style={styles.hint}>Drag to move · tap to click{'\n'}two fingers to scroll or right-click</Text>
      </View>
      <View style={[styles.row, settings.leftHanded && { flexDirection: 'row-reverse' }]}>
        <Button label="Click" style={styles.btn} onPressIn={() => press(0, true)} onPressOut={() => press(0, false)} />
        <Button label="Right" style={styles.btn} onPressIn={() => press(1, true)} onPressOut={() => press(1, false)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space(4), gap: space(3) },
  pad: { flex: 1, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'flex-end', padding: space(6) },
  hint: { ...type.caption, color: colors.muted, textAlign: 'center' },
  row: { flexDirection: 'row', gap: space(3) },
  btn: { flex: 1, minHeight: 64, borderRadius: radius.lg },
});
