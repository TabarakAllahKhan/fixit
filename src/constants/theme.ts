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

  // Home-screen palette. Named tokens keep the new surfaces consistent and
  // avoid scattering one-off hex values through the redesigned screen.
  forest: '#1B5E4A',
  forestDeep: '#164E3E',
  lime: '#D9EE7E',
  canvas: '#F7F8F6',
  ink: '#141D1A',
  mist: '#E4E9E6',
  heroSubtitle: '#CBE0D8',
  cardBorder: '#E2E8E4',
  bannerAmber: '#E59A24',
  bannerAmberSoft: '#FDF3E1',
  bannerSubtitle: '#5C6B64',
  secondaryFill: 'rgba(255,255,255,0.12)',
  secondaryBorder: 'rgba(255,255,255,0.22)',
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
  card: 16,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

/**
 * NativeWind equivalents of the Home StyleSheet tokens. Pressable base styles
 * must come from `className` in this SDK/NativeWind combination; `style` is
 * reserved for the transient pressed state.
 */
export const homeClassName = {
  avatar: 'h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-[#D9EE7E]',
  heroAction:
    'min-h-[48px] min-w-0 flex-1 flex-row items-center justify-center gap-[5px] rounded-[14px] px-[8px] py-[6px]',
  heroPrimary: 'bg-[#D9EE7E]',
  heroSecondary: 'border border-[#FFFFFF38] bg-[#FFFFFF1F]',
  chevronTouch: 'shrink-0 p-1',
  listCard:
    'flex-row items-center justify-between rounded-[16px] border border-[#E2E8E4] bg-white p-[14px]',
  gridCard: 'h-[148px] min-w-0 flex-1 rounded-[16px] border border-[#E2E8E4] bg-white p-[12px]',
  diagnosisGridCard:
    'h-[160px] min-w-0 flex-1 rounded-[16px] border border-[#E2E8E4] bg-white p-[12px]',
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
