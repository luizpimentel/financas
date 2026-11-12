import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  MAX_CENTS,
  ZERO,
  cents,
  formatBRL,
  parseBRL,
  type Cents,
} from '@/domain/money/Money';
import { colors, opacity, radii, sizes, spacing, typography, type FinancialTone } from '@/theme';

export type MoneyInputRejectReason =
  | 'INVALID_INPUT'
  | 'EXCEEDS_MAX_LIMIT'
  | 'NEGATIVE_NOT_ALLOWED';

export interface ProcessMoneyInputOptions {
  readonly maxCents?: Cents;
  readonly allowNegative?: boolean;
}

export type ProcessMoneyInputResult =
  | { readonly accepted: true; readonly valueCents: Cents }
  | { readonly accepted: false; readonly reason: MoneyInputRejectReason };

/**
 * Processa de forma pura e sem ponto flutuante qualquer alteração de texto no `MoneyInput`.
 *
 * Comportamentos suportados:
 *  1. Digitação incremental da direita para a esquerda:
 *     - "1" -> R$ 0,01 (1 centavo)
 *     - "2" -> R$ 0,12 (12 centavos)
 *     - "3" -> R$ 1,23 (123 centavos)
 *     - "4" -> R$ 12,34 (1234 centavos)
 *  2. Apagamento (Backspace):
 *     - Apagar 1 caractere de "R$ 12,34" ("R$ 12,3") -> R$ 1,23 (123 centavos)
 *     - Apagar de "R$ 0,01" ("R$ 0,0") -> R$ 0,00 (0 centavos)
 *     - Limpar tudo ("") -> R$ 0,00 (0 centavos)
 *  3. Colagem de valores formatados em pt-BR:
 *     - "R$ 1.306,00", "1.306,00", "12,5" (R$ 12,50), "-R$ 40,00" (se allowNegative)
 *  4. Rejeição segura de entradas inválidas ou acima de `maxCents`.
 */
export function processMoneyInputChange(
  currentCents: Cents,
  rawInput: string,
  options?: ProcessMoneyInputOptions,
): ProcessMoneyInputResult {
  const maxLimit = options?.maxCents ?? cents(MAX_CENTS);
  const allowNegative = options?.allowNegative ?? false;

  if (typeof rawInput !== 'string') {
    return { accepted: false, reason: 'INVALID_INPUT' };
  }

  const trimmed = rawInput.trim().replace(/\u00a0/g, ' ');
  if (trimmed === '' || /^[-−]?(\s*R\$)?$/i.test(trimmed)) {
    return { accepted: true, valueCents: ZERO };
  }

  const formattedCurrent = formatBRL(currentCents);
  if (trimmed === formattedCurrent) {
    return { accepted: true, valueCents: currentCents };
  }

  // Caso 1: Backspace no final do valor formatado atual (ex.: "R$ 12,34" -> "R$ 12,3")
  if (
    formattedCurrent.startsWith(trimmed) &&
    trimmed.length < formattedCurrent.length
  ) {
    const removedCount = formattedCurrent.length - trimmed.length;
    const currentNegative = currentCents < 0;
    const currentDigits = Math.abs(currentCents).toString();
    const nextDigits =
      removedCount >= currentDigits.length
        ? '0'
        : currentDigits.slice(0, currentDigits.length - removedCount);
    const magnitude = Number(BigInt(nextDigits));
    const signedValue = currentNegative && magnitude > 0 ? -magnitude : magnitude;
    return { accepted: true, valueCents: cents(signedValue) };
  }

  // Caso 2: Digitação incremental adicionando dígitos ao final do valor formatado atual
  // (ex.: "R$ 0,00" + "1" -> "R$ 0,001" ou "R$ 0,01" + "2" -> "R$ 0,012")
  if (
    trimmed.startsWith(formattedCurrent) &&
    /^\d+$/.test(trimmed.slice(formattedCurrent.length))
  ) {
    const appendedDigits = trimmed.slice(formattedCurrent.length);
    const currentNegative = currentCents < 0;
    const combinedDigits = `${Math.abs(currentCents).toString()}${appendedDigits}`;
    return finalizeDigitsToCents(combinedDigits, currentNegative, maxLimit, allowNegative);
  }

  // Caso 3: Sequência pura de dígitos (ex.: teclado numérico enviando "1", "12", "123", "1234")
  const pureDigitsMatch = /^([-−])?\s*(?:R\$\s*)?(\d+)$/i.exec(trimmed);
  if (pureDigitsMatch) {
    const isNegative = Boolean(pureDigitsMatch[1]);
    const digits = pureDigitsMatch[2] ?? '0';
    return finalizeDigitsToCents(digits, isNegative, maxLimit, allowNegative);
  }

  // Caso 4: Colagem de texto formatado com pontuação (vírgula e/ou ponto de milhar)
  try {
    const parsed = parseBRL(trimmed);
    if (parsed < 0 && !allowNegative) {
      return { accepted: false, reason: 'NEGATIVE_NOT_ALLOWED' };
    }
    if (Math.abs(parsed) > maxLimit) {
      return { accepted: false, reason: 'EXCEEDS_MAX_LIMIT' };
    }
    return { accepted: true, valueCents: parsed };
  } catch {
    return { accepted: false, reason: 'INVALID_INPUT' };
  }
}

function finalizeDigitsToCents(
  rawDigits: string,
  isNegative: boolean,
  maxLimit: Cents,
  allowNegative: boolean,
): ProcessMoneyInputResult {
  const normalizedDigits = rawDigits.replace(/^0+/, '') || '0';
  const magnitude = BigInt(normalizedDigits);

  if (magnitude > BigInt(MAX_CENTS) || magnitude > BigInt(maxLimit)) {
    return { accepted: false, reason: 'EXCEEDS_MAX_LIMIT' };
  }

  const numericValue = Number(magnitude);
  if (isNegative && numericValue > 0) {
    if (!allowNegative) {
      return { accepted: false, reason: 'NEGATIVE_NOT_ALLOWED' };
    }
    return { accepted: true, valueCents: cents(-numericValue) };
  }

  return { accepted: true, valueCents: cents(numericValue) };
}

export interface MoneyInputProps {
  /** Valor atual em centavos inteiros. */
  readonly valueCents: Cents;
  /** Callback disparado sempre que um novo valor válido em centavos é produzido. */
  readonly onChangeCents: (nextValue: Cents) => void;
  /** Rótulo exibido acima do campo. */
  readonly label?: string;
  /** Texto auxiliar exibido abaixo do campo. */
  readonly helperText?: string;
  /** Mensagem de erro de validação exibida abaixo do campo. */
  readonly errorMessage?: string;
  /** Limite máximo permitido em centavos (padrão: `MAX_CENTS`). */
  readonly maxCents?: Cents;
  /** Permite valores negativos (padrão: `false`). */
  readonly allowNegative?: boolean;
  /** Exibe botão rápido para zerar o valor quando `valueCents !== 0`. */
  readonly showClearButton?: boolean;
  /** Cor semântica de destaque do valor (ex.: `'income'`, `'expense'`, `'creditCard'`). */
  readonly tone?: FinancialTone;
  /** Desabilita a edição. */
  readonly disabled?: boolean;
  /** Callback opcional acionado quando uma entrada é rejeitada (limite ou formato inválido). */
  readonly onInputRejected?: (reason: MoneyInputRejectReason) => void;
  /** Identificador para testes automatizados. */
  readonly testID?: string;
  /** Estilo adicional do contêiner externo. */
  readonly containerStyle?: StyleProp<ViewStyle>;
  /** Estilo adicional do campo de texto. */
  readonly inputStyle?: StyleProp<TextStyle>;
}

export function MoneyInput({
  valueCents,
  onChangeCents,
  label,
  helperText,
  errorMessage,
  maxCents,
  allowNegative = false,
  showClearButton = true,
  tone = 'neutral',
  disabled = false,
  onInputRejected,
  testID = 'money-input',
  containerStyle,
  inputStyle,
}: MoneyInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const safeValue = cents(valueCents);
  const formattedValue = formatBRL(safeValue);
  const hasError = Boolean(errorMessage && errorMessage.trim().length > 0);

  const valueColor =
    tone === 'income'
      ? colors.financial.income
      : tone === 'expense'
        ? colors.financial.expense
        : tone === 'creditCard'
          ? colors.financial.creditCard
          : colors.text.primary;

  const borderColor = hasError
    ? colors.border.error
    : isFocused
      ? colors.border.focus
      : colors.border.subtle;

  function handleChangeText(rawText: string) {
    if (disabled) {
      return;
    }
    const result = processMoneyInputChange(safeValue, rawText, {
      maxCents,
      allowNegative,
    });
    if (result.accepted) {
      onChangeCents(result.valueCents);
    } else {
      onInputRejected?.(result.reason);
    }
  }

  function handleClear() {
    if (disabled) {
      return;
    }
    onChangeCents(ZERO);
  }

  return (
    <View style={[styles.wrapper, containerStyle]} testID={`${testID}-container`}>
      {label ? (
        <Text style={styles.label} testID={`${testID}-label`}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.fieldContainer,
          { borderColor },
          disabled ? styles.fieldDisabled : null,
        ]}
      >
        <View style={styles.currencyBadge}>
          <Text style={styles.currencySymbol}>$</Text>
        </View>

        <TextInput
          testID={testID}
          value={formattedValue}
          onChangeText={handleChangeText}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          editable={!disabled}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus={false}
          accessibilityLabel={label ? `${label}: ${formattedValue}` : `Valor em reais: ${formattedValue}`}
          accessibilityState={{ disabled }}
          style={[
            styles.input,
            { color: disabled ? colors.text.disabled : valueColor },
            inputStyle,
          ]}
        />

        {showClearButton && !disabled && safeValue !== 0 ? (
          <Pressable
            testID={`${testID}-clear-button`}
            onPress={handleClear}
            accessibilityRole="button"
            accessibilityLabel="Zerar valor"
            hitSlop={8}
            style={({ pressed }) => [
              styles.clearButton,
              pressed ? styles.clearButtonPressed : null,
            ]}
          >
            <Text style={styles.clearButtonText}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {hasError ? (
        <Text
          style={styles.errorText}
          testID={`${testID}-error`}
          accessibilityRole="alert"
        >
          {errorMessage}
        </Text>
      ) : helperText ? (
        <Text style={styles.helperText} testID={`${testID}-helper`}>
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  label: {
    ...typography.label,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
  },
  fieldContainer: {
    minHeight: sizes.inputHeight,
    backgroundColor: colors.background.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fieldDisabled: {
    backgroundColor: colors.background.surfaceDisabled,
    opacity: opacity.disabled,
  },
  currencyBadge: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.text.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  currencySymbol: {
    ...typography.label,
    color: colors.text.secondary,
  },
  input: {
    flex: 1,
    ...typography.moneyLarge,
    paddingVertical: spacing.sm,
  },
  clearButton: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.background.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  clearButtonPressed: {
    backgroundColor: colors.background.surfacePressed,
  },
  clearButtonText: {
    ...typography.label,
    color: colors.text.secondary,
  },
  helperText: {
    ...typography.caption,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
  errorText: {
    ...typography.errorText,
    color: colors.state.error,
    marginTop: spacing.xs,
  },
});

