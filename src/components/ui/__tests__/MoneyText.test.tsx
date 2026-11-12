import React from 'react';
import { describe, expect, it } from 'vitest';

import {
  MoneyText,
  formatMoneyTextDisplay,
  resolveMoneyTextColor,
} from '@/components/ui/MoneyText';
import {
  MAX_CENTS,
  MIN_CENTS,
  MoneyError,
  ZERO,
  cents,
} from '@/domain/money/Money';
import { renderTestTree } from '@/tests/rnTestHarness';
import { colors, typography } from '@/theme';

describe('MoneyText', () => {
  it('renderiza valores positivos formatados em BRL', () => {
    const tree = renderTestTree(<MoneyText valueCents={cents(130600)} />);
    const node = tree.getByTestId('money-text');

    expect(node.textContent).toBe('R$ 1.306,00');
    expect(node.props.accessibilityLabel).toBe('R$ 1.306,00');
  });

  it('exibe sinal "+" explícito em valores positivos quando showPlusSign=true', () => {
    const tree = renderTestTree(
      <MoneyText valueCents={cents(50000)} showPlusSign variant="income" />,
    );
    const node = tree.getByTestId('money-text');

    expect(node.textContent).toBe('+R$ 500,00');
    expect(node.style.color).toBe(colors.financial.income);
  });

  it('renderiza valores negativos com sinal "-" antes de R$ (mesmo se showPlusSign=true)', () => {
    const tree = renderTestTree(
      <MoneyText valueCents={cents(-4000)} showPlusSign variant="expense" />,
    );
    const node = tree.getByTestId('money-text');

    expect(node.textContent).toBe('-R$ 40,00');
    expect(node.style.color).toBe(colors.financial.expense);
  });

  it('renderiza valor zero corretamente sem sinal positivo', () => {
    const tree = renderTestTree(<MoneyText valueCents={ZERO} showPlusSign />);
    const node = tree.getByTestId('money-text');

    expect(node.textContent).toBe('R$ 0,00');
  });

  it('oculta o valor real quando masked=true', () => {
    const tree = renderTestTree(
      <MoneyText valueCents={cents(987654)} masked />,
    );
    const node = tree.getByTestId('money-text');

    expect(node.textContent).toBe('R$ ••••');
    expect(node.props.accessibilityLabel).toBe('R$ ••••');
  });

  it('aplica estilos semânticos de cor para cada variante financeira', () => {
    expect(resolveMoneyTextColor('neutral')).toBe(colors.text.primary);
    expect(resolveMoneyTextColor('income')).toBe(colors.financial.income);
    expect(resolveMoneyTextColor('expense')).toBe(colors.financial.expense);
    expect(resolveMoneyTextColor('creditCard')).toBe(colors.financial.creditCard);
    expect(resolveMoneyTextColor('transfer')).toBe(colors.financial.transfer);
    expect(resolveMoneyTextColor('pending')).toBe(colors.financial.pending);
    expect(resolveMoneyTextColor('warning')).toBe(colors.financial.warning);
    expect(resolveMoneyTextColor('muted')).toBe(colors.text.secondary);
  });

  it('aplica números tabulares (tabular-nums) e tamanhos tipográficos corretos', () => {
    const displayTree = renderTestTree(
      <MoneyText valueCents={cents(10000)} size="display" testID="m-display" />,
    );
    const smTree = renderTestTree(
      <MoneyText valueCents={cents(10000)} size="sm" testID="m-sm" />,
    );

    const displayNode = displayTree.getByTestId('m-display');
    const smNode = smTree.getByTestId('m-sm');

    expect(displayNode.style.fontSize).toBe(typography.moneyDisplay.fontSize);
    expect(displayNode.style.fontVariant).toEqual(['tabular-nums']);
    expect(smNode.style.fontSize).toBe(typography.moneySmall.fontSize);
    expect(smNode.style.fontVariant).toEqual(['tabular-nums']);
  });

  it('formata com exatidão os limites de inteiros seguros', () => {
    expect(formatMoneyTextDisplay(MAX_CENTS)).toBe('R$ 90.071.992.547.409,91');
    expect(formatMoneyTextDisplay(MIN_CENTS)).toBe('-R$ 90.071.992.547.409,91');
  });

  it('rejeita números não inteiros (ponto flutuante)', () => {
    expect(() => formatMoneyTextDisplay(12.34)).toThrow(MoneyError);
  });
});

