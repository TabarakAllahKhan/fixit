export const colors = {
  primary: '#176B5B',
  primaryPressed: '#12574A',
  primarySoft: '#E8F2EF',
  background: '#F6F8F5',
  surface: '#FFFFFF',
  surfaceAlt: '#FBFCFA',
  heading: '#192722',
  text: '#192722',
  secondary: '#68756E',
  muted: '#8A9590',
  border: '#E7ECE8',
  borderStrong: '#D3DDD7',
  accent: '#D6ED83',
  accentSoft: '#F3F9DD',
  success: '#27845B',
  warning: '#E6A23C',
  error: '#D85C52',
  errorSoft: '#FDF0EF',
  white: '#FFFFFF',
  overlay: 'rgba(25, 39, 34, 0.35)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  screen: 24,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999,
} as const;

export const fontFamily = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semiBold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
} as const;

export const type = {
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.8,
    color: colors.heading,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.secondary,
  },
  label: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.heading,
  },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  button: {
    fontFamily: fontFamily.semiBold,
    fontSize: 16,
    lineHeight: 20,
    color: colors.white,
  },
  caption: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.secondary,
  },
} as const;
