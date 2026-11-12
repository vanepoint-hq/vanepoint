// Small shared UI primitives.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { colors, radius, space, type } from './theme';

export function Logo({ size = 48 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#8068E2" />
          <Stop offset="1" stopColor="#5B43C4" />
        </LinearGradient>
      </Defs>
      <Rect width="512" height="512" rx="116" fill="url(#g)" />
      <Path d="M187.9 156.2 A70 70 0 0 1 232.5 207.4" stroke="#fff" strokeWidth={28} strokeLinecap="round" fill="none" />
      <Path d="M205.0 109.2 A120 120 0 0 1 281.4 197.1" stroke="#fff" strokeOpacity={0.78} strokeWidth={28} strokeLinecap="round" fill="none" />
      <Path d="M222.1 62.3 A170 170 0 0 1 330.3 186.7" stroke="#fff" strokeOpacity={0.55} strokeWidth={28} strokeLinecap="round" fill="none" />
      <Polygon points="164,222 164,424.8 218.1,377 253.4,457 287.8,442.5 253.4,363.4 322.1,363.4" fill="#fff" />
    </Svg>
  );
}

export function Dot({ color }: { color: string }) {
  return (
    <Svg width={10} height={10}>
      <Circle cx={5} cy={5} r={4} fill={color} />
    </Svg>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  onPressIn,
  onPressOut,
  variant = 'secondary',
  style,
  textStyle,
  disabled,
  accessibilityHint,
  children,
}: {
  label?: string;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  variant?: Variant;
  style?: ViewStyle | ViewStyle[];
  textStyle?: TextStyle;
  disabled?: boolean;
  accessibilityHint?: string;
  children?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [styles.btn, styles[variant], pressed && styles.pressed, disabled && styles.disabled, style as ViewStyle]}
    >
      {children ?? <Text style={[styles.btnText, variant === 'primary' || variant === 'danger' ? styles.onBrand : null, textStyle]}>{label}</Text>}
    </Pressable>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.micro}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    paddingHorizontal: space(4),
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.brand, borderColor: colors.brand },
  secondary: { backgroundColor: colors.raised, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.85 },
  disabled: { opacity: 0.4 },
  btnText: { ...type.headline, color: colors.text },
  onBrand: { color: '#fff' },
  micro: { ...type.micro, color: colors.brandText, textTransform: 'uppercase' },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space(4) },
});
