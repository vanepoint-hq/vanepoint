// Air Pointer: hold the pad and point; large click buttons at thumb height.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useConnection } from '../connection';
import { haptic } from '../haptics';
import { colors, radius, space, type } from '../theme';
import { Button } from '../ui';
import { useAirPointer } from '../useAirPointer';

export function AirSurface() {
  const { send, control, settings } = useConnection();
  const [holding, setHolding] = useState(false);
  const alwaysOn = !settings.clutch;
  useAirPointer(holding || alwaysOn);

  const press = (button: number, down: boolean) => {
    send({ type: 'button', button, down });
    if (down) haptic(button === 0 ? 'click' : 'click_strong');
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={alwaysOn ? 'Pointer is always on' : 'Hold to point'}
        accessibilityHint="While held, moving the phone moves the pointer"
        onPressIn={() => setHolding(true)}
        onPressOut={() => setHolding(false)}
        onLongPress={() => undefined}
        delayLongPress={100_000}
        style={[styles.pad, (holding || alwaysOn) && styles.padActive]}
      >
        <Text style={styles.padTitle}>{alwaysOn ? 'POINTING' : holding ? 'POINTING' : 'HOLD TO POINT'}</Text>
        <Text style={styles.padHint}>{alwaysOn ? 'Always-on mode. Change it in Settings.' : 'Point the top of your phone at the screen and sweep.'}</Text>
      </Pressable>
      <View style={[styles.row, settings.leftHanded && { flexDirection: 'row-reverse' }]}>
        <Button label="Click" style={styles.big} onPressIn={() => press(0, true)} onPressOut={() => press(0, false)} accessibilityHint="Hold to drag" />
        <Button label="Right" style={styles.big} onPressIn={() => press(1, true)} onPressOut={() => press(1, false)} />
      </View>
      <Button
        label="Recenter"
        variant="ghost"
        onPress={() => {
          control({ op: 'recenter' });
          haptic('click');
        }}
        accessibilityHint="Moves the pointer to the middle of the main display"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space(4), gap: space(3) },
  pad: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space(6),
    gap: space(2),
  },
  padActive: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  padTitle: { ...type.micro, fontSize: 13, color: colors.brandText },
  padHint: { ...type.callout, color: colors.muted, textAlign: 'center' },
  row: { flexDirection: 'row', gap: space(3) },
  big: { flex: 1, minHeight: 88, borderRadius: radius.lg },
});
