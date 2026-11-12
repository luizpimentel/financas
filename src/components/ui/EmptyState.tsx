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

export interface EmptyStateProps {
  /** Título principal do estado vazio. */
  readonly title: string;
  /** Descrição explicativa abaixo do título. */
  readonly description: string;
  /** Ícone opcional (string simbólica ou elemento React customizado). */
  readonly icon?: ReactNode | string;
  /** Texto do botão de ação opcional (ex.: "Novo lançamento"). */
  readonly actionLabel?: string;
  /** Callback acionado ao pressionar o botão de ação opcional. */
  readonly onActionPress?: () => void;
  /** Identificador para testes automatizados. */
  readonly testID?: string;
  /** Estilo adicional do contêiner. */
  readonly style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  title,
  description,
  icon = '∅',
  actionLabel,
  onActionPress,
  testID = 'empty-state',
  style,
}: EmptyStateProps) {
  const showAction = Boolean(actionLabel && onActionPress);

  return (
    <View testID={testID} style={[styles.container, style]}>
      <View style={styles.iconCircle} testID={`${testID}-icon`}>
        {typeof icon === 'string' ? (
          <Text style={styles.iconText}>{icon}</Text>
        ) : (
          icon
        )}
      </View>

      <Text style={styles.title} testID={`${testID}-title`}>
        {title}
      </Text>

      <Text style={styles.description} testID={`${testID}-description`}>
        {description}
      </Text>

      {showAction ? (
        <Pressable
          testID={`${testID}-action-button`}
          onPress={onActionPress}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.actionButton,
            pressed ? styles.actionButtonPressed : null,
          ]}
        >
          <Text style={styles.actionButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.background.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconText: {
    fontSize: 24,
    lineHeight: 28,
    color: colors.text.secondary,
    fontWeight: '600',
  },
  title: {
    ...typography.titleSmall,
    color: colors.text.primary,
    textAlign: 'center',
  },
  description: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  actionButton: {
    minHeight: sizes.buttonHeightSmall,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.button.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  actionButtonPressed: {
    backgroundColor: colors.button.primaryPressedBg,
  },
  actionButtonText: {
    ...typography.label,
    color: colors.button.primaryText,
  },
});

