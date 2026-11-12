import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { cents, formatBRL, type Cents } from '@/domain/money/Money';
import { colors, typography, type FinancialTone, type MoneySizeVariant } from '@/theme';

export interface MoneyTextProps extends Omit<TextProps, 'children'> {
  /** Valor em centavos inteiros (ex.: 130600 -> "R$ 1.306,00"). */
  readonly valueCents: Cents | number;
  /** Variante semântica de cor financeira. Padrão: 'neutral'. */
  readonly variant?: FinancialTone;
  /** Escala tipográfica com números tabulares. Padrão: 'md'. */
  readonly size?: MoneySizeVariant;
  /** Exibe sinal "+" explícito quando o valor for estritamente positivo (> 0). */
  readonly showPlusSign?: boolean;
  /** Oculta o valor real exibindo máscara de privacidade ("R$ ••••"). */
  readonly masked?: boolean;
  /** Estilo adicional opcional. */
  readonly style?: StyleProp<TextStyle>;
}

const SIZE_STYLE_MAP: Record<MoneySizeVariant, TextStyle> = {
  sm: typography.moneySmall,
  md: typography.moneyMedium,
  lg: typography.moneyLarge,
  display: typography.moneyDisplay,
};

export function resolveMoneyTextColor(variant: FinancialTone): string {
  switch (variant) {
    case 'income':
      return colors.financial.income;
    case 'expense':
      return colors.financial.expense;
    case 'creditCard':
      return colors.financial.creditCard;
    case 'transfer':
      return colors.financial.transfer;
    case 'pending':
      return colors.financial.pending;
    case 'warning':
      return colors.financial.warning;
    case 'muted':
      return colors.text.secondary;
    case 'neutral':
    default:
      return colors.text.primary;
  }
}

export function formatMoneyTextDisplay(
  valueCents: Cents | number,
  options?: { readonly showPlusSign?: boolean; readonly masked?: boolean },
): string {
  const validated = cents(valueCents);
  if (options?.masked) {
    return 'R$ ••••';
  }
  const formatted = formatBRL(validated);
  if (options?.showPlusSign && validated > 0) {
    return `+${formatted}`;
  }
  return formatted;
}

export function MoneyText({
  valueCents,
  variant = 'neutral',
  size = 'md',
  showPlusSign = false,
  masked = false,
  style,
  accessibilityLabel,
  testID = 'money-text',
  ...rest
}: MoneyTextProps) {
  const displayText = formatMoneyTextDisplay(valueCents, { showPlusSign, masked });
  const textColor = resolveMoneyTextColor(variant);
  const typographyStyle = SIZE_STYLE_MAP[size];

  return (
    <Text
      {...rest}
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? displayText}
      style={[styles.base, typographyStyle, { color: textColor }, style]}
    >
      {displayText}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
});

