import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  AppHeader,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  MoneyInput,
  MoneyText,
  MonthNavigator,
  SyncStatusIndicator,
  type MoneyInputRejectReason,
  type SyncStatusKind,
} from '@/components/ui';
import { ZERO, cents, type Cents } from '@/domain/money/Money';
import { colors, radii, sizes, spacing, typography, type FinancialTone } from '@/theme';
import type { MonthPeriod } from '@/utils/monthPeriod';

const SYNC_STATUS_OPTIONS: readonly SyncStatusKind[] = [
  'synced',
  'syncing',
  'offline',
  'cached',
  'error',
] as const;

const INPUT_TONE_OPTIONS: readonly {
  readonly tone: FinancialTone;
  readonly label: string;
}[] = [
  { tone: 'neutral', label: 'Padrão' },
  { tone: 'income', label: 'Receita' },
  { tone: 'expense', label: 'Despesa' },
  { tone: 'creditCard', label: 'Cartão' },
] as const;

const DEMO_MAX_CENTS = cents(99_999_999_99); // R$ 99.999.999,99

/**
 * Catálogo interativo temporário da Tarefa T1.2 para inspeção e validação
 * no dispositivo Android/iOS de todos os componentes do Design System.
 */
export default function DesignSystemShowcaseScreen() {
  const [period, setPeriod] = useState<MonthPeriod>({ year: 2026, month: 11 });
  const [maskedValues, setMaskedValues] = useState(false);

  const [inputValueCents, setInputValueCents] = useState<Cents>(cents(1234));
  const [inputTone, setInputTone] = useState<FinancialTone>('neutral');
  const [rejectFeedback, setRejectFeedback] = useState<string | undefined>(undefined);

  const [activeSyncStatus, setActiveSyncStatus] = useState<SyncStatusKind>('synced');
  const [actionFeedback, setActionFeedback] = useState<string>(
    'Interaja com os controles abaixo para testar cada componente.',
  );

  const [dialogMode, setDialogMode] = useState<'none' | 'standard' | 'destructive'>('none');

  function handleMoneyChange(nextCents: Cents) {
    setRejectFeedback(undefined);
    setInputValueCents(nextCents);
  }

  function handleMoneyRejected(reason: MoneyInputRejectReason) {
    if (reason === 'EXCEEDS_MAX_LIMIT') {
      setRejectFeedback('Limite máximo de demonstração atingido (R$ 99.999.999,99).');
    } else if (reason === 'NEGATIVE_NOT_ALLOWED') {
      setRejectFeedback('Valores negativos não são permitidos neste campo.');
    } else {
      setRejectFeedback('Formato monetário inválido ignorado.');
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader
        title="Catálogo UI (T1.2)"
        subtitle="Design System Escuro & Componentes Base"
        onBackPress={() =>
          setActionFeedback('Botão Voltar do AppHeader pressionado.')
        }
        showBottomDivider
        rightActions={
          <Pressable
            testID="demo-toggle-mask-button"
            onPress={() => setMaskedValues((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={
              maskedValues ? 'Mostrar valores monetários' : 'Ocultar valores monetários'
            }
            style={({ pressed }) => [
              styles.headerActionPill,
              pressed ? styles.headerActionPillPressed : null,
            ]}
          >
            <Text style={styles.headerActionText}>
              {maskedValues ? 'Mostrar R$' : 'Ocultar R$'}
            </Text>
          </Pressable>
        }
      />

      <MonthNavigator
        month={period.month}
        year={period.year}
        onChangePeriod={(next) => {
          setPeriod(next);
          setActionFeedback(`Período alterado para ${next.month}/${next.year}.`);
        }}
        onPressLabel={() => {
          setPeriod({ year: 2026, month: 11 });
          setActionFeedback('Período redefinido para 11/2026.');
        }}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.feedbackBanner} testID="demo-feedback-banner">
          <Text style={styles.feedbackText}>{actionFeedback}</Text>
        </View>

        {/* 1. MoneyText */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>1. MoneyText (Centavos Inteiros)</Text>
          <Text style={styles.sectionSubtitle}>
            Formatação BRL tabular sem ponto flutuante
          </Text>

          <View style={styles.moneyRow}>
            <Text style={styles.moneyRowLabel}>Destaque (Display)</Text>
            <MoneyText
              valueCents={cents(250000)}
              size="display"
              variant="neutral"
              masked={maskedValues}
            />
          </View>

          <View style={styles.moneyRow}>
            <Text style={styles.moneyRowLabel}>Receita (+ sinal)</Text>
            <MoneyText
              valueCents={cents(185000)}
              size="lg"
              variant="income"
              showPlusSign
              masked={maskedValues}
            />
          </View>

          <View style={styles.moneyRow}>
            <Text style={styles.moneyRowLabel}>Despesa (negativo)</Text>
            <MoneyText
              valueCents={cents(-4590)}
              size="md"
              variant="expense"
              masked={maskedValues}
            />
          </View>

          <View style={styles.moneyRow}>
            <Text style={styles.moneyRowLabel}>Cartão de crédito</Text>
            <MoneyText
              valueCents={cents(78900)}
              size="md"
              variant="creditCard"
              masked={maskedValues}
            />
          </View>

          <View style={styles.moneyRow}>
            <Text style={styles.moneyRowLabel}>Pendente / Previsto</Text>
            <MoneyText
              valueCents={cents(32000)}
              size="sm"
              variant="pending"
              masked={maskedValues}
            />
          </View>

          <View style={styles.moneyRow}>
            <Text style={styles.moneyRowLabel}>Saldo Zero</Text>
            <MoneyText
              valueCents={ZERO}
              size="sm"
              variant="muted"
              masked={maskedValues}
            />
          </View>
        </View>

        {/* 2. MoneyInput */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>2. MoneyInput (Máscara Direita → Esquerda)</Text>
          <Text style={styles.sectionSubtitle}>
            Digite 1 → R$ 0,01 | 2 → R$ 0,12 | 3 → R$ 1,23 | 4 → R$ 12,34
          </Text>

          <View style={styles.chipGroup}>
            {INPUT_TONE_OPTIONS.map((item) => {
              const selected = inputTone === item.tone;
              return (
                <Pressable
                  key={item.tone}
                  onPress={() => setInputTone(item.tone)}
                  accessibilityRole="button"
                  style={[
                    styles.chip,
                    selected ? styles.chipSelected : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selected ? styles.chipTextSelected : null,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <MoneyInput
            label="Valor do lançamento fictício"
            valueCents={inputValueCents}
            onChangeCents={handleMoneyChange}
            onInputRejected={handleMoneyRejected}
            maxCents={DEMO_MAX_CENTS}
            tone={inputTone}
            helperText={`Centavos inteiros atuais: ${inputValueCents} centavos`}
            errorMessage={rejectFeedback}
          />

          <View style={styles.quickButtonsRow}>
            <Pressable
              onPress={() => handleMoneyChange(ZERO)}
              style={styles.secondarySmallButton}
            >
              <Text style={styles.secondarySmallButtonText}>Zerar (0)</Text>
            </Pressable>

            <Pressable
              onPress={() => handleMoneyChange(cents(100000))}
              style={styles.secondarySmallButton}
            >
              <Text style={styles.secondarySmallButtonText}>R$ 1.000,00</Text>
            </Pressable>
          </View>
        </View>

        {/* 3. SyncStatusIndicator */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>3. SyncStatusIndicator</Text>
          <Text style={styles.sectionSubtitle}>
            Estados demonstrativos controlados via props
          </Text>

          <View style={styles.chipGroup}>
            {SYNC_STATUS_OPTIONS.map((statusOption) => {
              const selected = activeSyncStatus === statusOption;
              return (
                <Pressable
                  key={statusOption}
                  onPress={() => setActiveSyncStatus(statusOption)}
                  accessibilityRole="button"
                  style={[
                    styles.chip,
                    selected ? styles.chipSelected : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selected ? styles.chipTextSelected : null,
                    ]}
                  >
                    {statusOption}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <SyncStatusIndicator
            status={activeSyncStatus}
            detail="Estado visual simulado localmente (sem conexão de rede nesta etapa)."
            onPress={() =>
              setActionFeedback(`Indicador de status "${activeSyncStatus}" pressionado.`)
            }
          />

          <View style={styles.compactRow}>
            <Text style={styles.moneyRowLabel}>Modo compacto:</Text>
            <SyncStatusIndicator status={activeSyncStatus} compact />
          </View>
        </View>

        {/* 4. EmptyState */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>4. EmptyState</Text>
          <EmptyState
            title="Nenhum lançamento neste período"
            description="Quando houver receitas ou despesas registradas para este mês, elas serão listadas aqui."
            actionLabel="Simular ação"
            onActionPress={() =>
              setActionFeedback('Ação do EmptyState acionada com sucesso.')
            }
          />
        </View>

        {/* 5. ErrorState */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>5. ErrorState</Text>
          <ErrorState
            message="Não foi possível atualizar os dados"
            details="Demonstração visual de estado de falha de comunicação."
            onRetry={() =>
              setActionFeedback('Botão "Tentar novamente" do ErrorState acionado.')
            }
          />
        </View>

        {/* 6. ConfirmationDialog */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>6. ConfirmationDialog</Text>
          <Text style={styles.sectionSubtitle}>
            Teste o modal padrão e a variante destrutiva
          </Text>

          <View style={styles.quickButtonsRow}>
            <Pressable
              testID="demo-open-standard-dialog"
              onPress={() => setDialogMode('standard')}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Abrir Diálogo Padrão</Text>
            </Pressable>

            <Pressable
              testID="demo-open-destructive-dialog"
              onPress={() => setDialogMode('destructive')}
              style={styles.destructiveButton}
            >
              <Text style={styles.destructiveButtonText}>Abrir Destrutivo</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <ConfirmationDialog
        visible={dialogMode !== 'none'}
        title={
          dialogMode === 'destructive'
            ? 'Cancelar lançamento fictício?'
            : 'Confirmar operação demonstrativa?'
        }
        message={
          dialogMode === 'destructive'
            ? 'Esta é uma demonstração visual da variante destrutiva do ConfirmationDialog.'
            : 'Nenhuma operação financeira real é executada nesta etapa (T1.2).'
        }
        confirmLabel={dialogMode === 'destructive' ? 'Sim, cancelar' : 'Confirmar'}
        cancelLabel="Voltar"
        destructive={dialogMode === 'destructive'}
        onConfirm={() => {
          setActionFeedback(`Diálogo (${dialogMode}) confirmado pelo usuário.`);
          setDialogMode('none');
        }}
        onCancel={() => {
          setActionFeedback(`Diálogo (${dialogMode}) fechado sem confirmar.`);
          setDialogMode('none');
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  headerActionPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.background.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  headerActionPillPressed: {
    backgroundColor: colors.background.surfacePressed,
  },
  headerActionText: {
    ...typography.caption,
    color: colors.text.primary,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  feedbackBanner: {
    backgroundColor: colors.background.surfaceSecondary,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  feedbackText: {
    ...typography.bodySmall,
    color: colors.text.secondary,
  },
  sectionCard: {
    backgroundColor: colors.background.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
  },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.text.muted,
    marginTop: -spacing.xs,
  },
  moneyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  moneyRowLabel: {
    ...typography.bodySmall,
    color: colors.text.secondary,
  },
  chipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.background.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  chipSelected: {
    backgroundColor: colors.financial.creditCardSoft,
    borderColor: colors.financial.creditCard,
  },
  chipText: {
    ...typography.caption,
    color: colors.text.secondary,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: colors.text.primary,
  },
  quickButtonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondarySmallButton: {
    flex: 1,
    minHeight: sizes.buttonHeightSmall,
    borderRadius: radii.md,
    backgroundColor: colors.button.secondaryBg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondarySmallButtonText: {
    ...typography.label,
    color: colors.button.secondaryText,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  primaryButton: {
    flex: 1,
    minHeight: sizes.buttonHeight,
    borderRadius: radii.md,
    backgroundColor: colors.button.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: {
    ...typography.label,
    color: colors.button.primaryText,
  },
  destructiveButton: {
    flex: 1,
    minHeight: sizes.buttonHeight,
    borderRadius: radii.md,
    backgroundColor: colors.button.destructiveBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  destructiveButtonText: {
    ...typography.label,
    color: colors.button.destructiveText,
  },
});
