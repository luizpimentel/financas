/**
 * Escala de espaçamentos, raios de borda, dimensões mínimas de toque e estados de interação.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 9999,
} as const;

export const iconSizes = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export const sizes = {
  minTouchTarget: 44,
  buttonHeight: 48,
  buttonHeightSmall: 38,
  inputHeight: 54,
  headerHeight: 56,
} as const;

export const opacity = {
  disabled: 0.45,
  pressed: 0.82,
  subtle: 0.7,
} as const;

export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radii;
export type IconSizeToken = keyof typeof iconSizes;

