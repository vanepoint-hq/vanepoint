import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectionProvider, useConnection } from './src/connection';
import { ControlScreen } from './src/screens/ControlScreen';
import { PairScreen } from './src/screens/PairScreen';
import { colors } from './src/theme';
import { Logo } from './src/ui';

function Root() {
  const { status } = useConnection();
  if (status === 'booting') {
    return (
      <View style={styles.center}>
        <Logo size={64} />
        <ActivityIndicator color={colors.brandText} style={{ marginTop: 24 }} />
      </View>
    );
  }
  return status === 'unpaired' ? <PairScreen /> : <ControlScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <ConnectionProvider>
        <Root />
      </ConnectionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
