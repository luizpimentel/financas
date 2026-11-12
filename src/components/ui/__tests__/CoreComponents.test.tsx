import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  AppHeader,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  MonthNavigator,
  SyncStatusIndicator,
  getSyncStatusDescriptor,
} from '@/components/ui';
import {
  resetMockSafeAreaInsets,
  setMockSafeAreaInsets,
} from '@/tests/mocks/react-native-safe-area-context';
import { renderTestTree } from '@/tests/rnTestHarness';
import { colors } from '@/theme';
import {
  createMonthPeriod,
  formatMonthPeriod,
  stepMonthPeriod,
} from '@/utils/monthPeriod';

describe('monthPeriod e MonthNavigator', () => {
  it('avança e retrocede meses incluindo virada de ano sem usar Date', () => {
    const dec2026 = createMonthPeriod(2026, 12);
    expect(stepMonthPeriod(dec2026, 1)).toEqual({ year: 2027, month: 1 });
    expect(stepMonthPeriod({ year: 2027, month: 1 }, -1)).toEqual({
      year: 2026,
      month: 12,
    });
    expect(stepMonthPeriod({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    });
    expect(stepMonthPeriod(dec2026, 14)).toEqual({ year: 2028, month: 2 });
  });

  it('formata mês e ano em pt-BR e suporta ocultação opcional do ano de referência', () => {
    const nov2026 = createMonthPeriod(2026, 11);
    expect(formatMonthPeriod(nov2026)).toBe('Novembro 2026');
    expect(
      formatMonthPeriod(nov2026, { alwaysShowYear: false, referenceYear: 2026 }),
    ).toBe('Novembro');
    expect(
      formatMonthPeriod(nov2026, { alwaysShowYear: false, referenceYear: 2025 }),
    ).toBe('Novembro 2026');
  });

  it('renderiza MonthNavigator e dispara callbacks para mês anterior e próximo', () => {
    const onChangePeriod = vi.fn();
    const tree = renderTestTree(
      <MonthNavigator
        month={12}
        year={2026}
        onChangePeriod={onChangePeriod}
      />,
    );

    expect(tree.getByTestId('month-navigator-label').textContent).toBe(
      'Dezembro 2026',
    );

    tree.firePress('month-navigator-prev-button');
    expect(onChangePeriod).toHaveBeenCalledWith({ year: 2026, month: 11 });

    tree.firePress('month-navigator-next-button');
    expect(onChangePeriod).toHaveBeenCalledWith({ year: 2027, month: 1 });
  });
});

describe('AppHeader', () => {
  it('renderiza título, subtítulo, botão de voltar e respeita Safe Area', () => {
    setMockSafeAreaInsets({ top: 36 });
    const onBackPress = vi.fn();

    const tree = renderTestTree(
      <AppHeader
        title="Contas"
        subtitle="Saldo consolidado"
        onBackPress={onBackPress}
      />,
    );

    const header = tree.getByTestId('app-header');
    expect(header.style.paddingTop).toBe(36);
    expect(tree.getByTestId('app-header-title').textContent).toBe('Contas');
    expect(tree.getByTestId('app-header-subtitle').textContent).toBe(
      'Saldo consolidado',
    );

    tree.firePress('app-header-back-button');
    expect(onBackPress).toHaveBeenCalledTimes(1);

    resetMockSafeAreaInsets();
  });
});

describe('SyncStatusIndicator', () => {
  it('mapeia todos os 5 estados de sincronização com cores e rótulos distintos', () => {
    expect(getSyncStatusDescriptor('synced').label).toBe('Sincronizado');
    expect(getSyncStatusDescriptor('syncing').label).toBe('Sincronizando...');
    expect(getSyncStatusDescriptor('offline').label).toBe('Offline');
    expect(getSyncStatusDescriptor('cached').label).toBe('Dados em cache');
    expect(getSyncStatusDescriptor('error').label).toBe('Erro de sincronização');
    expect(getSyncStatusDescriptor('error').foregroundColor).toBe(
      colors.state.error,
    );
  });

  it('renderiza rótulo, detalhe e aciona onPress quando fornecido', () => {
    const onPress = vi.fn();
    const tree = renderTestTree(
      <SyncStatusIndicator
        status="offline"
        detail="2 rascunhos locais"
        onPress={onPress}
      />,
    );

    expect(tree.getByTestId('sync-status-indicator-label').textContent).toBe(
      'Offline',
    );
    expect(tree.getByTestId('sync-status-indicator-detail').textContent).toBe(
      '2 rascunhos locais',
    );

    tree.firePress('sync-status-indicator');
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyState, ErrorState e ConfirmationDialog', () => {
  it('renderiza EmptyState com ação opcional', () => {
    const onActionPress = vi.fn();
    const tree = renderTestTree(
      <EmptyState
        title="Sem registros"
        description="Adicione um item para começar."
        actionLabel="Adicionar"
        onActionPress={onActionPress}
      />,
    );

    expect(tree.getByTestId('empty-state-title').textContent).toBe('Sem registros');
    tree.firePress('empty-state-action-button');
    expect(onActionPress).toHaveBeenCalledTimes(1);
  });

  it('renderiza ErrorState com detalhes e botão de tentar novamente', () => {
    const onRetry = vi.fn();
    const tree = renderTestTree(
      <ErrorState
        message="Falha ao carregar"
        details="Verifique sua conexão."
        onRetry={onRetry}
      />,
    );

    expect(tree.getByTestId('error-state-message').textContent).toBe(
      'Falha ao carregar',
    );
    expect(tree.getByTestId('error-state-details').textContent).toBe(
      'Verifique sua conexão.',
    );
    tree.firePress('error-state-retry-button');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('controla visibilidade, estilo destrutivo e ações do ConfirmationDialog', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    const hiddenTree = renderTestTree(
      <ConfirmationDialog
        visible={false}
        title="Confirmar?"
        message="Detalhe"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(hiddenTree.queryByTestId('confirmation-dialog')).toBeUndefined();

    const visibleTree = renderTestTree(
      <ConfirmationDialog
        visible
        title="Cancelar lançamento?"
        message="Esta ação marcará o registro como cancelado."
        confirmLabel="Sim, cancelar"
        cancelLabel="Voltar"
        destructive
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(visibleTree.getByTestId('confirmation-dialog-title').textContent).toBe(
      'Cancelar lançamento?',
    );
    const confirmBtn = visibleTree.getByTestId('confirmation-dialog-confirm-button');
    expect(confirmBtn.style.backgroundColor).toBe(colors.button.destructiveBg);

    visibleTree.firePress('confirmation-dialog-cancel-button');
    expect(onCancel).toHaveBeenCalledTimes(1);

    visibleTree.firePress('confirmation-dialog-confirm-button');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

