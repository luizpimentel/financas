import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, opacity, radii, sizes, spacing, typography } from '@/theme';

export interface ConfirmationDialogProps {
  /** Controla se o diálogo está visível. */
  readonly visible: boolean;
  /** Título do diálogo de confirmação. */
  readonly title: string;
  /** Mensagem descritiva da ação. */
  readonly message: string;
  /** Rótulo do botão de confirmação (padrão: "Confirmar"). */
  readonly confirmLabel?: string;
  /** Rótulo do botão de cancelamento (padrão: "Cancelar"). */
  readonly cancelLabel?: string;
  /** Aplica estilo destrutivo (vermelho/coral) ao botão de confirmação. */
  readonly destructive?: boolean;
  /** Desabilita botões enquanto uma ação estiver em andamento. */
  readonly disabled?: boolean;
  /** Callback acionado ao confirmar. */
  readonly onConfirm: () => void;
  /** Callback acionado ao cancelar ou fechar o modal. */
  readonly onCancel: () => void;
  /** Identificador para testes automatizados. */
  readonly testID?: string;
}

export function ConfirmationDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  disabled = false,
  onConfirm,
  onCancel,
  testID = 'confirmation-dialog',
}: ConfirmationDialogProps) {
  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.backdrop} testID={testID}>
        <View
          style={styles.dialogCard}
          accessibilityRole="alert"
          accessibilityLabel={`${title}. ${message}`}
        >
          <Text style={styles.title} testID={`${testID}-title`}>
            {title}
          </Text>

          <Text style={styles.message} testID={`${testID}-message`}>
            {message}
          </Text>

          <View style={styles.actionsRow}>
            <Pressable
              testID={`${testID}-cancel-button`}
              onPress={onCancel}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              accessibilityState={{ disabled }}
              style={({ pressed }) => [
                styles.button,
                styles.cancelButton,
                pressed && !disabled ? styles.cancelButtonPressed : null,
                disabled ? styles.buttonDisabled : null,
              ]}
            >
              <Text style={styles.cancelButtonText}>{cancelLabel}</Text>
            </Pressable>

            <Pressable
              testID={`${testID}-confirm-button`}
              onPress={onConfirm}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ disabled }}
              style={({ pressed }) => [
                styles.button,
                destructive ? styles.destructiveButton : styles.confirmButton,
                pressed && !disabled
                  ? destructive
                    ? styles.destructiveButtonPressed
                    : styles.confirmButtonPressed
                  : null,
                disabled ? styles.buttonDisabled : null,
              ]}
            >
              <Text
                style={
                  destructive
                    ? styles.destructiveButtonText
                    : styles.confirmButtonText
                }
              >
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.background.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.background.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.xl,
  },
  title: {
    ...typography.titleSmall,
    color: colors.text.primary,
  },
  message: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  button: {
    flex: 1,
    minHeight: sizes.buttonHeight,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: colors.button.secondaryBg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  cancelButtonPressed: {
    backgroundColor: colors.button.secondaryPressedBg,
  },
  cancelButtonText: {
    ...typography.label,
    color: colors.button.secondaryText,
  },
  confirmButton: {
    backgroundColor: colors.button.primaryBg,
  },
  confirmButtonPressed: {
    backgroundColor: colors.button.primaryPressedBg,
  },
  confirmButtonText: {
    ...typography.label,
    color: colors.button.primaryText,
  },
  destructiveButton: {
    backgroundColor: colors.button.destructiveBg,
  },
  destructiveButtonPressed: {
    backgroundColor: colors.button.destructivePressedBg,
  },
  destructiveButtonText: {
    ...typography.label,
    color: colors.button.destructiveText,
  },
  buttonDisabled: {
    opacity: opacity.disabled,
  },
});

