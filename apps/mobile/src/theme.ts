// Design tokens (docs/DESIGN_SYSTEM.md). The phone UI is dark by default so it never
// lights up a presenter's face.
export const colors = {
  bg: '#0B0B12',
  surface: '#12121C',
  raised: '#1C1C29',
  border: '#2A2A3A',
  text: '#ECECF4',
  muted: '#8A8AA3',
  brand: '#6E56CF',
  brandText: '#B4A7F0',
  brandSoft: '#241F45',
  success: '#3DD68C',
  warning: '#F5A524',
  danger: '#F2555A',
  laser: '#FF3B30',
};

export const radius = { sm: 8, md: 12, lg: 20, xl: 32 };
export const space = (n: number) => n * 4;

export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '600' as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600' as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 17, lineHeight: 22 },
  callout: { fontSize: 15, lineHeight: 20 },
  caption: { fontSize: 13, lineHeight: 16, fontWeight: '500' as const },
  micro: { fontSize: 11, lineHeight: 13, fontWeight: '700' as const, letterSpacing: 0.6 },
};
