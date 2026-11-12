import React, { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radii, sizes, spacing, typography } from '@/theme';

export interface ErrorStateProps {
  /** Mensagem principal do erro. */
  readonly message: string;
  /** Detalhes técnicos ou instruções complementares opcionais. */
  readonly details?: string;
  /** Ícone opcional (string simbólica ou elemento React). */
  readonly icon?: ReactNode | string;
  /** Texto do botão de tentar novamente (padrão: "Tentar novamente"). */
  readonly retryLabel?: string;
  /** Callback opcional para tentar novamente. */
  readonly onRetry?: () => void;
  /** Identificador para testes automatizados. */
  readonly testID?: string;
  /** Estilo adicional do contêiner. */
  readonly style?: StyleProp<ViewStyle>;
}

export function ErrorState({
  message,
  details,
  icon = '!',
  retryLabel = 'Tentar novamente',
  onRetry,
  testID = 'error-state',
  style,
}: ErrorStateProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={[styles.container, style]}
    >
      <View style={styles.iconCircle} testID={`${testID}-icon`}>
        {typeof icon === 'string' ? (
          <Text style={styles.iconText}>{icon}</Text>
        ) : (
          icon
        )}
      </View>

      <Text style={styles.message} testID={`${testID}-message`}>
        {message}
      </Text>

      {details ? (
        <Text style={styles.details} testID={`${testID}-details`}>
          {details}
        </Text>
      ) : null}

      {onRetry ? (
        <Pressable
          testID={`${testID}-retry-button`}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          style={({ pressed }) => [
            styles.retryButton,
            pressed ? styles.retryButtonPressed : null,
          ]}
        >
          <Text style={styles.retryButtonText}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.state.errorBg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.error,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.state.error,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconText: {
    fontSize: 22,
    lineHeight: 26,
    color: colors.text.inverse,
    fontWeight: '700',
  },
  message: {
    ...typography.subtitle,
    color: colors.text.primary,
    textAlign: 'center',
  },
  details: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  retryButton: {
    minHeight: sizes.buttonHeightSmall,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.button.destructiveBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  retryButtonPressed: {
    backgroundColor: colors.button.destructivePressedBg,
  },
  retryButtonText: {
    ...typography.label,
    color: colors.button.destructiveText,
  },
});

