import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, opacity, radii, sizes, spacing, typography } from '@/theme';
import {
  createMonthPeriod,
  formatMonthPeriod,
  stepMonthPeriod,
  type MonthNumber,
  type MonthPeriod,
} from '@/utils/monthPeriod';

export interface MonthNavigatorProps {
  /** Mês selecionado (1 = Janeiro .. 12 = Dezembro). */
  readonly month: MonthNumber;
  /** Ano selecionado (ex.: 2026). */
  readonly year: number;
  /** Callback acionado com o novo período `(year, month)` ao avançar ou retroceder. */
  readonly onChangePeriod: (nextPeriod: MonthPeriod) => void;
  /** Callback opcional ao tocar diretamente no rótulo central do mês/ano. */
  readonly onPressLabel?: () => void;
  /** Exibe sempre o ano ao lado do mês (padrão: `true`). */
  readonly alwaysShowYear?: boolean;
  /** Ano de referência para ocultar o ano quando `alwaysShowYear` for `false`. */
  readonly referenceYear?: number;
  /** Exibe sublinhado de destaque sob o rótulo do mês (padrão: `true`, inspirado na referência). */
  readonly underlinedLabel?: boolean;
  /** Desabilita os botões de navegação. */
  readonly disabled?: boolean;
  /** Identificador para testes automatizados. */
  readonly testID?: string;
  /** Estilo adicional do contêiner. */
  readonly style?: StyleProp<ViewStyle>;
}

export function MonthNavigator({
  month,
  year,
  onChangePeriod,
  onPressLabel,
  alwaysShowYear = true,
  referenceYear,
  underlinedLabel = true,
  disabled = false,
  testID = 'month-navigator',
  style,
}: MonthNavigatorProps) {
  const currentPeriod = createMonthPeriod(year, month);
  const labelText = formatMonthPeriod(currentPeriod, {
    alwaysShowYear,
    referenceYear,
  });

  function handlePrevious() {
    if (disabled) {
      return;
    }
    onChangePeriod(stepMonthPeriod(currentPeriod, -1));
  }

  function handleNext() {
    if (disabled) {
      return;
    }
    onChangePeriod(stepMonthPeriod(currentPeriod, 1));
  }

  return (
    <View testID={testID} style={[styles.container, style]}>
      <Pressable
        testID={`${testID}-prev-button`}
        onPress={handlePrevious}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Mês anterior"
        accessibilityState={{ disabled }}
        hitSlop={8}
        style={({ pressed }) => [
          styles.navButton,
          pressed && !disabled ? styles.navButtonPressed : null,
          disabled ? styles.navButtonDisabled : null,
        ]}
      >
        <Text style={styles.chevron}>‹</Text>
      </Pressable>

      <Pressable
        testID={`${testID}-label-button`}
        onPress={onPressLabel}
        disabled={disabled || !onPressLabel}
        accessibilityRole={onPressLabel ? 'button' : 'text'}
        accessibilityLabel={`Período selecionado: ${labelText}`}
        style={({ pressed }) => [
          styles.labelWrapper,
          pressed && onPressLabel && !disabled ? styles.labelPressed : null,
        ]}
      >
        <View style={underlinedLabel ? styles.underlineContainer : undefined}>
          <Text testID={`${testID}-label`} style={styles.labelText}>
            {labelText}
          </Text>
        </View>
      </Pressable>

      <Pressable
        testID={`${testID}-next-button`}
        onPress={handleNext}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Próximo mês"
        accessibilityState={{ disabled }}
        hitSlop={8}
        style={({ pressed }) => [
          styles.navButton,
          pressed && !disabled ? styles.navButtonPressed : null,
          disabled ? styles.navButtonDisabled : null,
        ]}
      >
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    backgroundColor: colors.background.primary,
  },
  navButton: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonPressed: {
    backgroundColor: colors.background.surfaceSecondary,
  },
  navButtonDisabled: {
    opacity: opacity.disabled,
  },
  chevron: {
    fontSize: 26,
    lineHeight: 28,
    color: colors.text.secondary,
    fontWeight: '400',
  },
  labelWrapper: {
    minHeight: sizes.minTouchTarget,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  labelPressed: {
    backgroundColor: colors.background.surfaceSecondary,
  },
  underlineContainer: {
    borderBottomWidth: 1.5,
    borderBottomColor: colors.text.primary,
    paddingBottom: 2,
  },
  labelText: {
    ...typography.subtitle,
    color: colors.text.primary,
  },
});

