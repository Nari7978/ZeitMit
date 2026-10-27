import { Platform, TextStyle } from 'react-native';

// Palette from ZeitMit App v3 (1c "bold & playful" direction).
export const colors = {
  sun: '#FFE94D', // app background
  ink: '#111111', // text, borders, hard shadows
  white: '#FFFFFF',
  cream: '#FFF8D6',
  butter: '#FFF4B8',
  blush: '#FFD6E5',
  pink: '#FF4F8B',
  rose: '#E8336F',
  roseDeep: '#B0124E',
  violet: '#7B5CFF',
  lilac: '#E6DEFF',
  mint: '#2ED19A',
  mintSoft: '#C8F3E2',
  green: '#178A60',
  greenDeep: '#12704E',
  greenSoft: '#E7F5EE',
  amber: '#E99A24',
  amberSoft: '#FDF3E2',
  amberDeep: '#8A5A0F',
  red: '#D9435F',
  redSoft: '#FCEBEE',
  redDeep: '#A8304A',
  gray900: '#222222',
  gray800: '#2A2A2A',
  gray600: '#4A4A4A',
  gray500: '#666666',
  gray400: '#8A8A8A',
  gray350: '#9A9A9A',
  gray300: '#BDBDBD',
  hairline: 'rgba(17,17,17,.12)',
  track: 'rgba(17,17,17,.16)',
  scrim: 'rgba(18,14,38,.45)',
  shimmerA: '#EEECF5',
} as const;

export type Weight = 400 | 500 | 600 | 700 | 800;

const DM: Record<Weight, string> = {
  400: 'DMSans_400Regular',
  500: 'DMSans_500Medium',
  600: 'DMSans_600SemiBold',
  700: 'DMSans_700Bold',
  800: 'DMSans_700Bold', // the design only loads DM Sans up to 700
};

const BRIC: Record<Weight, string> = {
  400: 'BricolageGrotesque_600SemiBold',
  500: 'BricolageGrotesque_600SemiBold',
  600: 'BricolageGrotesque_600SemiBold',
  700: 'BricolageGrotesque_700Bold',
  800: 'BricolageGrotesque_800ExtraBold',
};

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });

export type FontKind = 'body' | 'display' | 'mono';

export function font(kind: FontKind, weight: Weight = 400): TextStyle {
  if (kind === 'mono') return { fontFamily: mono, fontWeight: String(weight) as TextStyle['fontWeight'] };
  return { fontFamily: (kind === 'display' ? BRIC : DM)[weight] };
}

/** Converts the design's em letter-spacing to RN points. */
export const em = (size: number, value: number) => size * value;
