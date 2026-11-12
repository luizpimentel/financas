import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';

export type SyncStatusKind =
  | 'synced'
  | 'syncing'
  | 'offline'
  | 'cached'
  | 'error';

export interface SyncStatusDescriptor {
  readonly status: SyncStatusKind;
  readonly label: string;
  readonly symbol: string;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly borderColor: string;
}

const STATUS_DESCRIPTORS: Record<SyncStatusKind, SyncStatusDescriptor> = {
  synced: {
    status: 'synced',
    label: 'Sincronizado',
    symbol: '✓',
    foregroundColor: colors.state.success,
    backgroundColor: colors.state.successBg,
    borderColor: colors.border.success,
  },
  syncing: {
    status: 'syncing',
    label: 'Sincronizando...',
    symbol: '⟳',
    foregroundColor: colors.state.info,
    backgroundColor: colors.state.infoBg,
    borderColor: colors.border.focus,
  },
  offline: {
    status: 'offline',
    label: 'Offline',
    symbol: '☁',
    foregroundColor: colors.state.warning,
    backgroundColor: colors.state.warningBg,
    borderColor: colors.state.warning,
  },
  cached: {
    status: 'cached',
    label: 'Dados em cache',
    symbol: '◈',
    foregroundColor: colors.financial.transfer,
    backgroundColor: colors.financial.transferSoft,
    borderColor: colors.border.default,
  },
  error: {
    status: 'error',
    label: 'Erro de sincronização',
    symbol: '⚠',
    foregroundColor: colors.state.error,
    backgroundColor: colors.state.errorBg,
    borderColor: colors.border.error,
  },
};

export function getSyncStatusDescriptor(status: SyncStatusKind): SyncStatusDescriptor {
  return STATUS_DESCRIPTORS[status];
}

export interface SyncStatusIndicatorProps {
  /** Estado atual de sincronização exibido visualmente (via props demonstrativas na T1.2). */
  readonly status: SyncStatusKind;
  /** Rótulo customizado opcional (substitui o rótulo padrão do estado). */
  readonly customLabel?: string;
  /** Detalhe complementar opcional (ex.: "2 rascunhos locais" ou "Tocar para tentar novamente"). */
  readonly detail?: string;
  /** Modo compacto em formato de pílula reduzida. */
  readonly compact?: boolean;
  /** Ação opcional ao tocar no indicador. */
  readonly onPress?: () => void;
  /** Identificador para testes automatizados. */
  readonly testID?: string;
  /** Estilo adicional do contêiner. */
  readonly style?: StyleProp<ViewStyle>;
}

export function SyncStatusIndicator({
  status,
  customLabel,
  detail,
  compact = false,
  onPress,
  testID = 'sync-status-indicator',
  style,
}: SyncStatusIndicatorProps) {
  const descriptor = getSyncStatusDescriptor(status);
  const displayLabel = customLabel ?? descriptor.label;
  const fullAccessibilityLabel = detail
    ? `Status de sincronização: ${displayLabel}. ${detail}`
    : `Status de sincronização: ${displayLabel}`;

  const content = (
    <View
      style={[
        styles.badge,
        compact ? styles.badgeCompact : styles.badgeRegular,
        {
          backgroundColor: descriptor.backgroundColor,
          borderColor: descriptor.borderColor,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: descriptor.foregroundColor },
        ]}
      >
        <Text style={styles.symbolText} testID={`${testID}-symbol`}>
          {descriptor.symbol}
        </Text>
      </View>

      <View style={styles.textColumn}>
        <Text
          testID={`${testID}-label`}
          style={[
            compact ? styles.labelCompact : styles.label,
            { color: descriptor.foregroundColor },
          ]}
          numberOfLines={1}
        >
          {displayLabel}
        </Text>
        {!compact && detail ? (
          <Text
            testID={`${testID}-detail`}
            style={styles.detail}
            numberOfLines={2}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={fullAccessibilityLabel}
        style={({ pressed }) => (pressed ? styles.pressed : undefined)}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={fullAccessibilityLabel}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.md,
  },
  badgeRegular: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  badgeCompact: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  symbolText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
    color: colors.text.inverse,
  },
  textColumn: {
    flexShrink: 1,
  },
  label: {
    ...typography.label,
  },
  labelCompact: {
    ...typography.caption,
    fontWeight: '600',
  },
  detail: {
    ...typography.caption,
    color: colors.text.secondary,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.8,
  },
});

