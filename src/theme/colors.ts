/**
 * Paleta de cores e tokens semânticos do Design System (Tema Escuro Nativo).
 *
 * Nenhum componente de interface deve usar valores hexadecimais avulsos;
 * todas as referências de cor devem passar por estes tokens semânticos.
 */

export const palette = {
  obsidian950: '#0B0D10',
  slate900: '#16191E',
  slate850: '#1A1E24',
  slate800: '#1F242B',
  slate750: '#282F38',
  slate700: '#323944',
  slate600: '#4B525E',
  slate500: '#6E7683',
  slate400: '#8E95A2',
  slate300: '#9BA3B0',
  white: '#FFFFFF',

  emerald500: '#4CAF7D',
  emerald600: '#3E9668',
  emerald950: '#1A382B',

  coral500: '#E57373',
  coral600: '#CC5F5F',
  coral950: '#3B2023',

  blue500: '#5C9CE6',
  blue600: '#4A86CC',
  blue950: '#1D2F4C',

  sky400: '#64B5F6',
  sky950: '#1A2E44',

  amber400: '#F2C94C',
  amber950: '#3A3118',

  steel400: '#90A4AE',
  steel900: '#222B32',

  overlayDark: 'rgba(0, 0, 0, 0.72)',
  transparent: 'transparent',
} as const;

export const colors = {
  background: {
    primary: palette.obsidian950,
    surface: palette.slate900,
    surfaceSecondary: palette.slate800,
    surfacePressed: palette.slate750,
    surfaceDisabled: palette.slate850,
    overlay: palette.overlayDark,
  },
  text: {
    primary: palette.white,
    secondary: palette.slate300,
    muted: palette.slate500,
    disabled: palette.slate600,
    inverse: palette.obsidian950,
  },
  financial: {
    income: palette.emerald500,
    incomeSoft: palette.emerald950,
    expense: palette.coral500,
    expenseSoft: palette.coral950,
    creditCard: palette.blue500,
    creditCardSoft: palette.blue950,
    transfer: palette.steel400,
    transferSoft: palette.steel900,
    pending: palette.sky400,
    pendingSoft: palette.sky950,
    warning: palette.amber400,
    warningSoft: palette.amber950,
    neutral: palette.white,
  },
  state: {
    success: palette.emerald500,
    successBg: palette.emerald950,
    error: palette.coral500,
    errorBg: palette.coral950,
    warning: palette.amber400,
    warningBg: palette.amber950,
    info: palette.sky400,
    infoBg: palette.sky950,
  },
  border: {
    subtle: '#262B33',
    default: palette.slate700,
    focus: palette.blue500,
    error: palette.coral500,
    success: palette.emerald500,
  },
  divider: '#1E232A',
  button: {
    primaryBg: palette.blue500,
    primaryPressedBg: palette.blue600,
    primaryText: palette.white,
    incomeBg: palette.emerald500,
    incomePressedBg: palette.emerald600,
    incomeText: palette.white,
    expenseBg: palette.coral500,
    expensePressedBg: palette.coral600,
    expenseText: palette.white,
    secondaryBg: palette.slate800,
    secondaryPressedBg: palette.slate750,
    secondaryText: palette.white,
    destructiveBg: palette.coral500,
    destructivePressedBg: palette.coral600,
    destructiveText: palette.white,
    disabledBg: palette.slate850,
    disabledText: palette.slate600,
  },
} as const;

export type ThemeColors = typeof colors;
export type FinancialTone =
  | 'neutral'
  | 'income'
  | 'expense'
  | 'creditCard'
  | 'transfer'
  | 'pending'
  | 'warning'
  | 'muted';

