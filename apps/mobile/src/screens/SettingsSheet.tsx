// Settings: pointer speed, axes, clutch, scrolling, haptics, sensor check, forget desktop.
import { AirPointer } from '@vanepoint/core';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnection } from '../connection';
import { subscribeMotion } from '../motionSource';
import { colors, radius, space, type } from '../theme';
import { Button, Card, SectionLabel } from '../ui';

function Row({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        {hint && <Text style={styles.hint}>{hint}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.brand, false: colors.border }} thumbColor="#fff" accessibilityLabel={label} />
    </View>
  );
}

/** Live view of the pointer pipeline so users (and developers) can verify axes. */
function SensorCheck() {
  const [v, setV] = useState({ vx: 0, vy: 0 });
  const pointer = useRef(new AirPointer());
  const { settings } = useConnection();
  useEffect(() => {
    pointer.current.opts = { ...pointer.current.opts, invertX: settings.invertX, invertY: settings.invertY, speed: settings.speed };
    let first = true;
    let last = 0;
    const un = subscribeMotion((s) => {
      if (first) {
        pointer.current.recenter(s.gravityDown);
        first = false;
      }
      const out = pointer.current.process(s.omega, s.gravityDown, s.t);
      if (Date.now() - last > 50) {
        last = Date.now();
        setV(out);
      }
    }, 16);
    return un;
  }, [settings.invertX, settings.invertY, settings.speed]);
  const clamp = (x: number) => Math.max(-1, Math.min(1, x / 1500));
  return (
    <View style={styles.check}>
      <View style={styles.checkBox}>
        <View style={[styles.checkDot, { left: `${50 + clamp(v.vx) * 45}%`, top: `${50 + clamp(v.vy) * 45}%` }]} />
      </View>
      <Text style={styles.hint}>Sweep right: the dot moves right. Tilt the top up: the dot moves up. If not, use the invert switches.</Text>
    </View>
  );
}

export function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { settings, updateSettings, desktop, forget } = useConnection();
  const insets = useSafeAreaInsets();
  const speeds = [
    { label: 'Slow', value: 0.6 },
    { label: 'Normal', value: 1 },
    { label: 'Fast', value: 1.6 },
  ];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={[styles.wrap, { paddingBottom: insets.bottom + space(8) }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Button label="Done" variant="ghost" onPress={onClose} />
        </View>

        <SectionLabel>Pointer</SectionLabel>
        <Card>
          <Text style={styles.label}>Speed</Text>
          <View style={styles.segment}>
            {speeds.map((s) => (
              <Button key={s.label} label={s.label} variant={settings.speed === s.value ? 'primary' : 'secondary'} style={{ flex: 1 }} onPress={() => updateSettings({ speed: s.value })} />
            ))}
          </View>
          <Row label="Hold to point" hint="The pointer moves only while your thumb is on the pad." value={settings.clutch} onChange={(v) => updateSettings({ clutch: v })} />
          <Row label="Invert horizontal" value={settings.invertX} onChange={(v) => updateSettings({ invertX: v })} />
          <Row label="Invert vertical" value={settings.invertY} onChange={(v) => updateSettings({ invertY: v })} />
        </Card>

        <SectionLabel>Sensor check</SectionLabel>
        <Card>{visible && <SensorCheck />}</Card>

        <SectionLabel>Touch & feedback</SectionLabel>
        <Card>
          <Row label="Natural scrolling" hint="Content follows your fingers, like a touchscreen." value={settings.naturalScroll} onChange={(v) => updateSettings({ naturalScroll: v })} />
          <Row label="Haptics" value={settings.haptics} onChange={(v) => updateSettings({ haptics: v })} />
          <Row label="Left-handed layout" value={settings.leftHanded} onChange={(v) => updateSettings({ leftHanded: v })} />
        </Card>

        {desktop && (
          <>
            <SectionLabel>Paired computer</SectionLabel>
            <Card>
              <Text style={styles.label}>{desktop.name}</Text>
              <Text style={styles.hint}>Key {desktop.fingerprint} · {desktop.hosts.join(', ')} : {desktop.port}</Text>
              <Button
                label="Forget this computer"
                variant="secondary"
                style={{ marginTop: space(3) }}
                textStyle={{ color: colors.danger }}
                onPress={() =>
                  Alert.alert('Forget computer?', 'You will need to scan a new pairing code to reconnect.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Forget',
                      style: 'destructive',
                      onPress: () => {
                        onClose();
                        void forget();
                      },
                    },
                  ])
                }
              />
            </Card>
          </>
        )}
        <Text style={styles.fine}>Vanepoint 0.1 · open source (MIT) · input is end-to-end encrypted and never leaves your network.</Text>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space(4), gap: space(3) },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(2) },
  title: { ...type.title, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2) },
  label: { ...type.body, color: colors.text },
  hint: { ...type.caption, color: colors.muted, marginTop: 2 },
  segment: { flexDirection: 'row', gap: space(2), marginVertical: space(2) },
  check: { gap: space(2) },
  checkBox: { height: 160, borderRadius: radius.md, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  checkDot: { position: 'absolute', width: 20, height: 20, marginLeft: -10, marginTop: -10, borderRadius: 10, backgroundColor: colors.laser },
  fine: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: space(4) },
});
