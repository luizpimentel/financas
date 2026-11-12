import { colors } from './colors';
import { iconSizes, opacity, radii, sizes, spacing } from './tokens';
import { fontSizes, fontWeights, lineHeights, typography } from './typography';

export {
  colors,
  fontSizes,
  fontWeights,
  iconSizes,
  lineHeights,
  opacity,
  radii,
  sizes,
  spacing,
  typography,
};

export type { FinancialTone, ThemeColors } from './colors';
export type { IconSizeToken, RadiusToken, SpacingToken } from './tokens';
export type { MoneySizeVariant, TypographyVariant } from './typography';

export const theme = {
  colors,
  typography,
  spacing,
  radii,
  iconSizes,
  sizes,
  opacity,
} as const;

export type AppTheme = typeof theme;

