// Main screen: status strip, mode bar and the active surface.
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnection } from '../connection';
import { haptic } from '../haptics';
import { surfacesOf } from '../profile';
import { AirSurface } from '../surfaces/AirSurface';
import { ButtonsSurface } from '../surfaces/ButtonsSurface';
import { DialSurface } from '../surfaces/DialSurface';
import { PresentSurface } from '../surfaces/PresentSurface';
import { TrackballSurface } from '../surfaces/TrackballSurface';
import { TrackpadSurface } from '../surfaces/TrackpadSurface';
import { colors, radius, space, type } from '../theme';
import { Button, Dot } from '../ui';
import { SettingsSheet } from './SettingsSheet';

type Mode = 'air' | 'trackpad' | 'present' | 'trackball' | 'dial' | 'buttons';

const MODES: { id: Mode; label: string }[] = [
  { id: 'present', label: 'Present' },
  { id: 'air', label: 'Air' },
  { id: 'trackpad', label: 'Pad' },
  { id: 'trackball', label: 'Ball' },
  { id: 'dial', label: 'Dial' },
];

export function ControlScreen() {
  useKeepAwake();
  const { status, message, desktop, rttMs, profile, control, reconnect, remoteMode } = useConnection();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('present');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasButtons = surfacesOf(profile, 'buttons').length > 0;
  const modes = hasButtons ? [...MODES, { id: 'buttons' as Mode, label: 'Controls' }] : MODES;

  const choose = (m: Mode) => {
    setMode(m);
    haptic('click');
    control({ op: 'mode', mode: m === 'buttons' ? 'present' : m });
  };

  useEffect(() => {
    if (status === 'connected') control({ op: 'mode', mode: mode === 'buttons' ? 'present' : mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (remoteMode && MODES.some((m) => m.id === remoteMode.mode)) setMode(remoteMode.mode as Mode);
  }, [remoteMode]);

  useEffect(() => {
    if (mode === 'buttons' && !hasButtons) setMode('present');
  }, [hasButtons, mode]);

  const connected = status === 'connected';
  const dotColor = connected ? colors.success : status === 'connecting' ? colors.warning : colors.danger;
  const statusText = connected ? `${desktop?.name ?? 'Desktop'}${rttMs !== null ? ` · ${rttMs.toFixed(0)} ms` : ''}` : status === 'connecting' ? `Connecting to ${desktop?.name ?? 'desktop'}…` : 'Offline';

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.strip}>
        <Dot color={dotColor} />
        <Text style={styles.stripText} numberOfLines={1} accessibilityLiveRegion="polite">
          {statusText}
        </Text>
        {profile && <Text style={styles.chip}>{profile.name}</Text>}
        <Pressable onPress={() => setSettingsOpen(true)} accessibilityRole="button" accessibilityLabel="Settings" hitSlop={12} style={styles.gear}>
          <Text style={styles.gearText}>⚙︎</Text>
        </Pressable>
      </View>

      <View style={styles.modes} accessibilityRole="tablist">
        {modes.map((m) => (
          <Pressable
            key={m.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m.id }}
            onPress={() => choose(m.id)}
            style={[styles.mode, mode === m.id && styles.modeActive]}
          >
            <Text style={[styles.modeText, mode === m.id && styles.modeTextActive]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      {!connected && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{message ?? 'Not connected'}</Text>
          {status === 'offline' && <Button label="Reconnect" variant="primary" onPress={reconnect} style={{ minHeight: 40 }} />}
        </View>
      )}

      <View style={[styles.surface, !connected && { opacity: 0.45 }]} pointerEvents={connected ? 'auto' : 'none'}>
        {mode === 'air' && <AirSurface />}
        {mode === 'trackpad' && <TrackpadSurface />}
        {mode === 'present' && <PresentSurface />}
        {mode === 'trackball' && <TrackballSurface />}
        {mode === 'dial' && <DialSurface />}
        {mode === 'buttons' && <ButtonsSurface />}
      </View>

      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(4), height: 52 },
  stripText: { ...type.callout, color: colors.text, flex: 1 },
  chip: { ...type.caption, color: colors.brandText, backgroundColor: colors.brandSoft, paddingHorizontal: space(2), paddingVertical: 3, borderRadius: radius.sm, overflow: 'hidden' },
  gear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  gearText: { fontSize: 22, color: colors.muted },
  modes: { flexDirection: 'row', marginHorizontal: space(4), backgroundColor: colors.surface, borderRadius: radius.md, padding: 4, borderWidth: 1, borderColor: colors.border },
  mode: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space(2), borderRadius: radius.sm, minHeight: 40 },
  modeActive: { backgroundColor: colors.brand },
  modeText: { ...type.caption, color: colors.muted },
  modeTextActive: { color: '#fff' },
  banner: { margin: space(4), marginBottom: 0, padding: space(3), borderRadius: radius.md, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, gap: space(2) },
  bannerText: { ...type.callout, color: colors.text },
  surface: { flex: 1 },
});
