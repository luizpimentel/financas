import React, { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, sizes, spacing, typography } from '@/theme';

export interface AppHeaderProps {
  /** Título principal do cabeçalho. */
  readonly title: string;
  /** Subtítulo opcional exibido abaixo do título (ex.: total do mês ou tipo de lançamento). */
  readonly subtitle?: string;
  /** Callback opcional para exibir e acionar o botão de voltar à esquerda. */
  readonly onBackPress?: () => void;
  /** Rótulo de acessibilidade do botão de voltar (padrão: "Voltar"). */
  readonly backAccessibilityLabel?: string;
  /** Elemento opcional à esquerda quando não houver botão de voltar (ex.: botão de menu). */
  readonly leftAccessory?: ReactNode;
  /** Área de ações à direita (botões de busca, filtro, salvar, menu contextual). */
  readonly rightActions?: ReactNode;
  /** Aplica padding superior correspondente à Safe Area do dispositivo (padrão: `true`). */
  readonly respectSafeArea?: boolean;
  /** Exibe linha divisória sutil na base do cabeçalho (padrão: `false`). */
  readonly showBottomDivider?: boolean;
  /** Identificador para testes automatizados. */
  readonly testID?: string;
  /** Estilo adicional do contêiner. */
  readonly style?: StyleProp<ViewStyle>;
}

export function AppHeader({
  title,
  subtitle,
  onBackPress,
  backAccessibilityLabel = 'Voltar',
  leftAccessory,
  rightActions,
  respectSafeArea = true,
  showBottomDivider = false,
  testID = 'app-header',
  style,
}: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const paddingTop = respectSafeArea ? insets.top : 0;

  return (
    <View
      testID={testID}
      accessibilityRole="header"
      style={[
        styles.container,
        { paddingTop },
        showBottomDivider ? styles.bottomDivider : null,
        style,
      ]}
    >
      <View style={styles.row}>
        {onBackPress ? (
          <Pressable
            testID={`${testID}-back-button`}
            onPress={onBackPress}
            accessibilityRole="button"
            accessibilityLabel={backAccessibilityLabel}
            hitSlop={8}
            style={({ pressed }) => [
              styles.iconButton,
              pressed ? styles.iconButtonPressed : null,
            ]}
          >
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
        ) : leftAccessory ? (
          <View style={styles.leftAccessory} testID={`${testID}-left-accessory`}>
            {leftAccessory}
          </View>
        ) : null}

        <View style={styles.titleContainer}>
          <Text
            style={styles.title}
            numberOfLines={1}
            testID={`${testID}-title`}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={styles.subtitle}
              numberOfLines={1}
              testID={`${testID}-subtitle`}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        {rightActions ? (
          <View style={styles.rightActions} testID={`${testID}-right-actions`}>
            {rightActions}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background.primary,
    width: '100%',
  },
  bottomDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  row: {
    minHeight: sizes.headerHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginLeft: -spacing.xs,
  },
  iconButtonPressed: {
    backgroundColor: colors.background.surfaceSecondary,
  },
  backIcon: {
    fontSize: 22,
    lineHeight: 24,
    color: colors.text.primary,
    fontWeight: '600',
  },
  leftAccessory: {
    marginRight: spacing.md,
  },
  titleContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    ...typography.titleMedium,
    color: colors.text.primary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.text.secondary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: spacing.md,
  },
});

