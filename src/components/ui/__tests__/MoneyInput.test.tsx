import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  MoneyInput,
  processMoneyInputChange,
  type MoneyInputRejectReason,
} from '@/components/ui/MoneyInput';
import { MAX_CENTS, ZERO, cents, formatBRL, type Cents } from '@/domain/money/Money';
import { renderTestTree } from '@/tests/rnTestHarness';
import { colors } from '@/theme';

describe('MoneyInput — Digitação incremental da direita para a esquerda', () => {
  it('converte a sequência 1 -> 2 -> 3 -> 4 em R$ 0,01 -> R$ 0,12 -> R$ 1,23 -> R$ 12,34', () => {
    let current: Cents = ZERO;
    const onChangeCents = vi.fn((next: Cents) => {
      current = next;
    });

    const tree = renderTestTree(
      <MoneyInput valueCents={current} onChangeCents={onChangeCents} />,
    );
    expect(tree.getByTestId('money-input').props.value).toBe('R$ 0,00');

    // Digitar 1 sobre "R$ 0,00" -> "R$ 0,001"
    tree.fireChangeText('money-input', 'R$ 0,001');
    expect(current).toBe(1);
    tree.rerender(<MoneyInput valueCents={current} onChangeCents={onChangeCents} />);
    expect(tree.getByTestId('money-input').props.value).toBe('R$ 0,01');

    // Digitar 2 sobre "R$ 0,01" -> "R$ 0,012"
    tree.fireChangeText('money-input', 'R$ 0,012');
    expect(current).toBe(12);
    tree.rerender(<MoneyInput valueCents={current} onChangeCents={onChangeCents} />);
    expect(tree.getByTestId('money-input').props.value).toBe('R$ 0,12');

    // Digitar 3 sobre "R$ 0,12" -> "R$ 0,123"
    tree.fireChangeText('money-input', 'R$ 0,123');
    expect(current).toBe(123);
    tree.rerender(<MoneyInput valueCents={current} onChangeCents={onChangeCents} />);
    expect(tree.getByTestId('money-input').props.value).toBe('R$ 1,23');

    // Digitar 4 sobre "R$ 1,23" -> "R$ 1,234"
    tree.fireChangeText('money-input', 'R$ 1,234');
    expect(current).toBe(1234);
    tree.rerender(<MoneyInput valueCents={current} onChangeCents={onChangeCents} />);
    expect(tree.getByTestId('money-input').props.value).toBe('R$ 12,34');
  });

  it('aceita também dígitos puros enviados diretamente ("1" -> 1, "12" -> 12, "123" -> 123, "1234" -> 1234)', () => {
    expect(processMoneyInputChange(ZERO, '1')).toEqual({
      accepted: true,
      valueCents: cents(1),
    });
    expect(processMoneyInputChange(cents(1), '12')).toEqual({
      accepted: true,
      valueCents: cents(12),
    });
    expect(processMoneyInputChange(cents(12), '123')).toEqual({
      accepted: true,
      valueCents: cents(123),
    });
    expect(processMoneyInputChange(cents(123), '1234')).toEqual({
      accepted: true,
      valueCents: cents(1234),
    });
  });
});

describe('MoneyInput — Exclusão de dígitos (Backspace) e limpeza', () => {
  it('remove dígitos da direita para a esquerda até chegar a R$ 0,00', () => {
    let current: Cents = cents(1234); // "R$ 12,34"
    const onChangeCents = vi.fn((next: Cents) => {
      current = next;
    });

    const tree = renderTestTree(
      <MoneyInput valueCents={current} onChangeCents={onChangeCents} />,
    );

    // Backspace em "R$ 12,34" -> "R$ 12,3" (123 centavos = R$ 1,23)
    tree.fireChangeText('money-input', 'R$ 12,3');
    expect(current).toBe(123);
    tree.rerender(<MoneyInput valueCents={current} onChangeCents={onChangeCents} />);
    expect(tree.getByTestId('money-input').props.value).toBe('R$ 1,23');

    // Backspace em "R$ 1,23" -> "R$ 1,2" (12 centavos = R$ 0,12)
    tree.fireChangeText('money-input', 'R$ 1,2');
    expect(current).toBe(12);
    tree.rerender(<MoneyInput valueCents={current} onChangeCents={onChangeCents} />);
    expect(tree.getByTestId('money-input').props.value).toBe('R$ 0,12');

    // Backspace em "R$ 0,12" -> "R$ 0,1" (1 centavo = R$ 0,01)
    tree.fireChangeText('money-input', 'R$ 0,1');
    expect(current).toBe(1);
    tree.rerender(<MoneyInput valueCents={current} onChangeCents={onChangeCents} />);
    expect(tree.getByTestId('money-input').props.value).toBe('R$ 0,01');

    // Backspace em "R$ 0,01" -> "R$ 0,0" (0 centavos = R$ 0,00)
    tree.fireChangeText('money-input', 'R$ 0,0');
    expect(current).toBe(0);
    tree.rerender(<MoneyInput valueCents={current} onChangeCents={onChangeCents} />);
    expect(tree.getByTestId('money-input').props.value).toBe('R$ 0,00');
  });

  it('zera o valor ao limpar todo o texto ou tocar no botão de limpar', () => {
    const onChangeCents = vi.fn();
    const tree = renderTestTree(
      <MoneyInput valueCents={cents(45000)} onChangeCents={onChangeCents} />,
    );

    tree.firePress('money-input-clear-button');
    expect(onChangeCents).toHaveBeenCalledWith(0);

    expect(processMoneyInputChange(cents(45000), '')).toEqual({
      accepted: true,
      valueCents: ZERO,
    });
  });
});

describe('MoneyInput — Colagem, precisão monetária, limites e entradas inválidas', () => {
  it('interpreta colagem de valores formatados em pt-BR sem usar parseFloat', () => {
    expect(processMoneyInputChange(ZERO, 'R$ 1.306,00')).toEqual({
      accepted: true,
      valueCents: cents(130600),
    });
    expect(processMoneyInputChange(ZERO, '1.234.567,89')).toEqual({
      accepted: true,
      valueCents: cents(123456789),
    });
    expect(processMoneyInputChange(ZERO, '12,5')).toEqual({
      accepted: true,
      valueCents: cents(1250),
    });
    // Caso clássico onde parseFloat('1.15') * 100 daria 114.99999999999999
    expect(processMoneyInputChange(ZERO, '1,15')).toEqual({
      accepted: true,
      valueCents: cents(115),
    });
    expect(processMoneyInputChange(ZERO, '19,90')).toEqual({
      accepted: true,
      valueCents: cents(1990),
    });
  });

  it('suporta valores grandes até MAX_CENTS e rejeita valores acima do limite', () => {
    const atMax = processMoneyInputChange(ZERO, formatBRL(cents(MAX_CENTS)));
    expect(atMax).toEqual({
      accepted: true,
      valueCents: cents(MAX_CENTS),
    });

    const overMax = processMoneyInputChange(cents(MAX_CENTS), `${formatBRL(cents(MAX_CENTS))}1`);
    expect(overMax).toEqual({
      accepted: false,
      reason: 'EXCEEDS_MAX_LIMIT',
    });

    const customLimit = cents(100_00); // R$ 100,00
    expect(
      processMoneyInputChange(ZERO, '150,00', { maxCents: customLimit }),
    ).toEqual({
      accepted: false,
      reason: 'EXCEEDS_MAX_LIMIT',
    });
  });

  it('rejeita entradas inválidas e aciona onInputRejected sem invocar onChangeCents', () => {
    const onChangeCents = vi.fn();
    const onInputRejected = vi.fn<(reason: MoneyInputRejectReason) => void>();

    const tree = renderTestTree(
      <MoneyInput
        valueCents={cents(500)}
        onChangeCents={onChangeCents}
        onInputRejected={onInputRejected}
      />,
    );

    tree.fireChangeText('money-input', 'abc');
    tree.fireChangeText('money-input', '1,234.56');
    tree.fireChangeText('money-input', '10,001');

    expect(onChangeCents).not.toHaveBeenCalled();
    expect(onInputRejected).toHaveBeenCalledTimes(3);
    expect(onInputRejected).toHaveBeenLastCalledWith('INVALID_INPUT');
  });

  it('bloqueia negativos por padrão e permite quando allowNegative=true', () => {
    expect(processMoneyInputChange(ZERO, '-R$ 40,00')).toEqual({
      accepted: false,
      reason: 'NEGATIVE_NOT_ALLOWED',
    });

    expect(
      processMoneyInputChange(ZERO, '-R$ 40,00', { allowNegative: true }),
    ).toEqual({
      accepted: true,
      valueCents: cents(-4000),
    });
  });

  it('respeita disabled, exibe errorMessage e aplica cor semântica tone', () => {
    const onChangeCents = vi.fn();
    const tree = renderTestTree(
      <MoneyInput
        valueCents={cents(2500)}
        onChangeCents={onChangeCents}
        label="Valor da receita"
        errorMessage="Valor obrigatório"
        tone="income"
        disabled
      />,
    );

    expect(tree.getByTestId('money-input-label').textContent).toBe('Valor da receita');
    expect(tree.getByTestId('money-input-error').textContent).toBe('Valor obrigatório');
    expect(tree.queryByTestId('money-input-clear-button')).toBeUndefined();

    tree.fireChangeText('money-input', 'R$ 25,001');
    expect(onChangeCents).not.toHaveBeenCalled();

    const activeTree = renderTestTree(
      <MoneyInput
        valueCents={cents(2500)}
        onChangeCents={onChangeCents}
        tone="income"
      />,
    );
    expect(activeTree.getByTestId('money-input').style.color).toBe(
      colors.financial.income,
    );
  });
});

