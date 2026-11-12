// Profile buttons: a 4-column grid generated from the focused app's profile.
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useConnection } from '../connection';
import { haptic } from '../haptics';
import { actionIndex, type ButtonControl, needsConfirm, surfacesOf } from '../profile';
import { colors, radius, space, type } from '../theme';
import { Button } from '../ui';

export function ButtonsSurface() {
  const { send, profile } = useConnection();
  const surfaces = surfacesOf(profile, 'buttons');

  const run = (c: ButtonControl) => {
    const id = actionIndex(profile, c.action);
    if (id === null) return;
    const fire = () => {
      send({ type: 'action', id });
      haptic(c.haptic === 'click_strong' ? 'click_strong' : c.haptic === 'success' ? 'success' : 'click');
    };
    if (needsConfirm(profile, c.action)) {
      Alert.alert(c.label, `Run “${c.label}” on the computer?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: c.label, style: c.emphasis === 'danger' ? 'destructive' : 'default', onPress: fire },
      ]);
    } else fire();
  };

  if (!surfaces.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.muted}>Switch to an app with a profile (PowerPoint, Keynote, Premiere Pro…) to see its controls here.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      {surfaces.map((s, si) => (
        <View key={si} style={{ gap: space(2) }}>
          <Text style={styles.micro}>{s.title ?? profile?.name}</Text>
          <View style={styles.grid}>
            {s.controls
              .filter((c): c is ButtonControl => c.type === 'button')
              .map((c, i) => (
                <View key={i} style={{ width: `${(Math.min(4, c.span ?? 1) / 4) * 100}%`, padding: space(1) }}>
                  <Button
                    label={c.label}
                    variant={c.emphasis === 'primary' ? 'primary' : c.emphasis === 'danger' ? 'danger' : 'secondary'}
                    style={styles.cell}
                    onPress={() => run(c)}
                  />
                </View>
              ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space(3), gap: space(5) },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { minHeight: 64, borderRadius: radius.md },
  micro: { ...type.micro, color: colors.brandText, textTransform: 'uppercase', paddingHorizontal: space(1) },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(8) },
  muted: { ...type.callout, color: colors.muted, textAlign: 'center' },
});
