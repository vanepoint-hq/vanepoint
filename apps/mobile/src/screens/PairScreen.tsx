// First run: scan the desktop's QR code (or paste its text) to pair.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnection } from '../connection';
import { colors, radius, space, type } from '../theme';
import { Button, Logo } from '../ui';

export function PairScreen() {
  const { pair, message } = useConnection();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  const submit = async (text: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setScanning(false);
    try {
      await pair(text);
    } catch (e) {
      setError((e as Error).message);
      handled.current = false;
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    setError(null);
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) {
        setError('Camera access is needed to scan the pairing code. You can paste the code instead.');
        return;
      }
    }
    handled.current = false;
    setScanning(true);
  };

  if (scanning) {
    return (
      <View style={styles.fill}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (handled.current || !data.startsWith('vanepoint://')) return;
            handled.current = true;
            void submit(data);
          }}
        />
        <View style={[styles.scanOverlay, { paddingTop: insets.top + space(6), paddingBottom: insets.bottom + space(6) }]}>
          <Text style={styles.scanTitle}>Scan the code on your computer</Text>
          <View style={styles.reticle} />
          <Button label="Cancel" onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + space(10), paddingBottom: insets.bottom + space(6) }]} keyboardShouldPersistTaps="handled">
        <Logo size={72} />
        <Text style={styles.title}>Vanepoint</Text>
        <Text style={styles.lead}>Your phone becomes an air mouse, presenter remote, trackball and dial for your computer.</Text>

        <View style={styles.steps}>
          {['Install and open Vanepoint on your computer.', 'Click “Pair a phone” to show a QR code.', 'Scan it here. You only need to do this once.'].map((s, i) => (
            <View key={s} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))}
        </View>

        {(error || message) && <Text style={styles.error}>{error ?? message}</Text>}

        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.brandText} />
            <Text style={styles.muted}>Waiting for you to approve on the computer…</Text>
          </View>
        ) : (
          <View style={styles.actions}>
            <Button label="Scan pairing code" variant="primary" onPress={() => void startScan()} />
            {manual ? (
              <View style={{ gap: space(2) }}>
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={setCode}
                  placeholder="vanepoint://pair?…"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                />
                <Button label="Pair" onPress={() => void submit(code)} disabled={!code.trim()} />
              </View>
            ) : (
              <Button label="Paste code instead" variant="ghost" onPress={() => setManual(true)} />
            )}
          </View>
        )}
        <Text style={styles.fine}>Everything stays on your network and is end-to-end encrypted. No account needed.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: space(6), alignItems: 'center', gap: space(4) },
  title: { ...type.display, color: colors.text, marginTop: space(2) },
  lead: { ...type.callout, color: colors.muted, textAlign: 'center', maxWidth: 320 },
  steps: { alignSelf: 'stretch', gap: space(3), marginTop: space(4) },
  step: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: colors.brandText, fontWeight: '700' },
  stepText: { ...type.callout, color: colors.text, flex: 1 },
  actions: { alignSelf: 'stretch', gap: space(2), marginTop: space(4) },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space(3),
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 13,
  },
  busy: { alignItems: 'center', gap: space(2), marginTop: space(6) },
  error: { ...type.callout, color: colors.warning, textAlign: 'center' },
  muted: { ...type.callout, color: colors.muted, textAlign: 'center' },
  fine: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: space(4) },
  scanOverlay: { flex: 1, alignItems: 'center', justifyContent: 'space-between' },
  scanTitle: { ...type.headline, color: '#fff', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: space(4), paddingVertical: space(2), borderRadius: radius.md, overflow: 'hidden' },
  reticle: { width: 240, height: 240, borderRadius: radius.xl, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' },
});
