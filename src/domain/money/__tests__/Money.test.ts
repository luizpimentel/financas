import { describe, expect, it } from 'vitest';

import {
  MAX_CENTS,
  MIN_CENTS,
  MoneyError,
  ZERO,
  abs,
  add,
  cents,
  compare,
  formatBRL,
  isCents,
  negate,
  netAmount,
  parseBRL,
  subtract,
  sum,
  type MoneyErrorCode,
} from '../Money';

function expectCode(fn: () => unknown, code: MoneyErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MoneyError);
    expect((error as MoneyError).code).toBe(code);
    return;
  }
  throw new Error(`Esperava MoneyError(${code}), mas nada foi lançado.`);
}

describe('cents()', () => {
  it('aceita inteiros, zero e negativos', () => {
    expect(cents(130600)).toBe(130600);
    expect(cents(0)).toBe(0);
    expect(cents(-4000)).toBe(-4000);
  });

  it('normaliza -0 para 0', () => {
    expect(Object.is(cents(-0), 0)).toBe(true);
  });

  it('rejeita casas decimais, NaN e Infinity', () => {
    expectCode(() => cents(10.5), 'NOT_AN_INTEGER');
    expectCode(() => cents(0.1 + 0.2), 'NOT_AN_INTEGER');
    expectCode(() => cents(Number.NaN), 'NOT_AN_INTEGER');
    expectCode(() => cents(Number.POSITIVE_INFINITY), 'NOT_AN_INTEGER');
  });

  it('rejeita inteiros fora do intervalo seguro', () => {
    expectCode(() => cents(Number.MAX_SAFE_INTEGER + 1), 'OUT_OF_SAFE_RANGE');
    expectCode(() => cents(Number.MIN_SAFE_INTEGER - 1), 'OUT_OF_SAFE_RANGE');
    expectCode(() => cents(1e300), 'OUT_OF_SAFE_RANGE');
  });

  it('aceita exatamente os limites seguros', () => {
    expect(cents(MAX_CENTS)).toBe(Number.MAX_SAFE_INTEGER);
    expect(cents(MIN_CENTS)).toBe(Number.MIN_SAFE_INTEGER);
  });

  it('isCents distingue valores válidos', () => {
    expect(isCents(100)).toBe(true);
    expect(isCents(1.5)).toBe(false);
    expect(isCents('100')).toBe(false);
  });
});

describe('parseBRL()', () => {
  it.each([
    ['1.306,00', 130600],
    ['1306,00', 130600],
    ['1306', 130600],
    ['R$ 1.306,00', 130600],
    ['R$1.306,00', 130600],
    ['r$ 10,50', 1050],
    ['0,05', 5],
    ['0,5', 50],
    ['12,5', 1250],
    ['0', 0],
    ['0,00', 0],
    ['1.234.567,89', 123456789],
    ['1.234', 123400],
    ['  42,10  ', 4210],
    ['120,00', 12000],
  ])('converte %j em %i centavos', (text, expected) => {
    expect(parseBRL(text)).toBe(expected);
  });

  it('interpreta valores negativos', () => {
    expect(parseBRL('-40,00')).toBe(-4000);
    expect(parseBRL('-R$ 40,00')).toBe(-4000);
    expect(parseBRL('R$ -40,00')).toBe(-4000);
    expect(parseBRL('\u2212130,00')).toBe(-13000);
  });

  it('trata "-0,00" como zero positivo', () => {
    expect(Object.is(parseBRL('-0,00'), 0)).toBe(true);
  });

  it('não sofre erro de ponto flutuante clássico', () => {
    // parseFloat('1.15') * 100 === 114.99999999999999
    expect(parseBRL('1,15')).toBe(115);
    expect(parseBRL('4,35')).toBe(435);
    expect(parseBRL('19,90')).toBe(1990);
  });

  it('rejeita entrada vazia', () => {
    expectCode(() => parseBRL(''), 'EMPTY_INPUT');
    expectCode(() => parseBRL('   '), 'EMPTY_INPUT');
    expectCode(() => parseBRL('R$'), 'EMPTY_INPUT');
    expectCode(() => parseBRL('-'), 'EMPTY_INPUT');
  });

  it('rejeita formatos inválidos', () => {
    expectCode(() => parseBRL('abc'), 'INVALID_FORMAT');
    expectCode(() => parseBRL('12,3x'), 'INVALID_FORMAT');
    expectCode(() => parseBRL('1,234.56'), 'INVALID_FORMAT');
    expectCode(() => parseBRL('1.2.3'), 'INVALID_FORMAT');
    expectCode(() => parseBRL('12.34'), 'INVALID_FORMAT');
    expectCode(() => parseBRL('1,2,3'), 'INVALID_FORMAT');
    expectCode(() => parseBRL('12,'), 'INVALID_FORMAT');
    expectCode(() => parseBRL(',50'), 'INVALID_FORMAT');
    expectCode(() => parseBRL('--5'), 'INVALID_FORMAT');
    expectCode(() => parseBRL('NaN'), 'INVALID_FORMAT');
    expectCode(() => parseBRL('Infinity'), 'INVALID_FORMAT');
    expectCode(() => parseBRL('1e3'), 'INVALID_FORMAT');
    expectCode(() => parseBRL(undefined as unknown as string), 'INVALID_FORMAT');
  });

  it('rejeita mais de duas casas decimais (sem arredondar)', () => {
    expectCode(() => parseBRL('10,001'), 'TOO_MANY_DECIMALS');
    expectCode(() => parseBRL('0,999'), 'TOO_MANY_DECIMALS');
    expectCode(() => parseBRL('1.000,125'), 'TOO_MANY_DECIMALS');
  });

  it('respeita os limites de inteiros seguros', () => {
    // MAX_SAFE_INTEGER = 9007199254740991 centavos
    expect(parseBRL('90.071.992.547.409,91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseBRL('-90.071.992.547.409,91')).toBe(Number.MIN_SAFE_INTEGER);
    expectCode(() => parseBRL('90.071.992.547.409,92'), 'OUT_OF_SAFE_RANGE');
    expectCode(() => parseBRL('999.999.999.999.999.999.999,99'), 'OUT_OF_SAFE_RANGE');
  });
});

describe('formatBRL()', () => {
  it.each([
    [130600, 'R$ 1.306,00'],
    [0, 'R$ 0,00'],
    [1, 'R$ 0,01'],
    [5, 'R$ 0,05'],
    [99, 'R$ 0,99'],
    [100, 'R$ 1,00'],
    [123456789, 'R$ 1.234.567,89'],
    [100000, 'R$ 1.000,00'],
    [99999, 'R$ 999,99'],
  ])('formata %i como %j', (value, expected) => {
    expect(formatBRL(cents(value))).toBe(expected);
  });

  it('formata negativos com sinal antes de R$', () => {
    expect(formatBRL(cents(-4000))).toBe('-R$ 40,00');
    expect(formatBRL(cents(-1))).toBe('-R$ 0,01');
    expect(formatBRL(cents(-123456))).toBe('-R$ 1.234,56');
  });

  it('formata os limites seguros sem perder precisão', () => {
    expect(formatBRL(cents(MAX_CENTS))).toBe('R$ 90.071.992.547.409,91');
    expect(formatBRL(cents(MIN_CENTS))).toBe('-R$ 90.071.992.547.409,91');
  });

  it('é inverso de parseBRL', () => {
    for (const value of [0, 1, 99, 100, 130600, -4000, 123456789, MAX_CENTS, MIN_CENTS]) {
      expect(parseBRL(formatBRL(cents(value)))).toBe(value);
    }
  });
});

describe('add / subtract / negate / abs / sum / compare', () => {
  it('soma e subtrai exatamente', () => {
    expect(add(cents(100000), cents(50000))).toBe(150000);
    expect(subtract(cents(150000), cents(20000))).toBe(130000);
  });

  it('não acumula erro de ponto flutuante', () => {
    // 0.1 + 0.2 em reais: 10 + 20 centavos
    expect(add(cents(10), cents(20))).toBe(30);
  });

  it('lida com zero e negativos', () => {
    expect(add(ZERO, ZERO)).toBe(0);
    expect(add(cents(-500), cents(500))).toBe(0);
    expect(subtract(cents(100), cents(300))).toBe(-200);
    expect(Object.is(subtract(cents(5), cents(5)), 0)).toBe(true);
    expect(negate(cents(250))).toBe(-250);
    expect(Object.is(negate(ZERO), 0)).toBe(true);
    expect(abs(cents(-250))).toBe(250);
  });

  it('rejeita overflow do intervalo seguro', () => {
    expectCode(() => add(cents(MAX_CENTS), cents(1)), 'OUT_OF_SAFE_RANGE');
    expectCode(() => subtract(cents(MIN_CENTS), cents(1)), 'OUT_OF_SAFE_RANGE');
    expectCode(() => subtract(cents(MAX_CENTS), cents(-1)), 'OUT_OF_SAFE_RANGE');
    expectCode(() => add(cents(MIN_CENTS), cents(-1)), 'OUT_OF_SAFE_RANGE');
  });

  it('o intervalo seguro é simétrico: negar o mínimo resulta exatamente no máximo', () => {
    expect(negate(cents(MIN_CENTS))).toBe(MAX_CENTS);
    expect(subtract(cents(0), cents(MIN_CENTS))).toBe(MAX_CENTS);
    expect(negate(cents(MAX_CENTS))).toBe(MIN_CENTS);
  });

  it('permite chegar exatamente ao limite', () => {
    expect(add(cents(MAX_CENTS - 1), cents(1))).toBe(MAX_CENTS);
  });

  it('sum() acumula e valida', () => {
    expect(sum([])).toBe(0);
    expect(sum([cents(33334), cents(33333), cents(33333)])).toBe(100000);
    expectCode(() => sum([cents(MAX_CENTS), cents(1)]), 'OUT_OF_SAFE_RANGE');
  });

  it('compare() ordena', () => {
    expect(compare(cents(1), cents(2))).toBe(-1);
    expect(compare(cents(2), cents(2))).toBe(0);
    expect(compare(cents(3), cents(2))).toBe(1);
  });

  it('reproduz os cenários de saldo do plano (receita e despesa)', () => {
    const saldo = cents(100000); // R$ 1.000,00
    const aposReceita = add(saldo, cents(50000)); // + R$ 500,00
    expect(aposReceita).toBe(150000);
    expect(subtract(aposReceita, cents(20000))).toBe(130000); // - R$ 200,00
  });
});

describe('netAmount() — encargos e descontos', () => {
  it('calcula base + encargos - desconto', () => {
    expect(netAmount(cents(10000), cents(500), cents(200))).toBe(10300);
  });

  it('sem encargos nem desconto retorna a base', () => {
    expect(netAmount(cents(10000), ZERO, ZERO)).toBe(10000);
  });

  it('permite resultado zero (desconto total)', () => {
    expect(netAmount(cents(10000), ZERO, cents(10000))).toBe(0);
    expect(netAmount(ZERO, ZERO, ZERO)).toBe(0);
  });

  it('rejeita componentes negativos', () => {
    expectCode(() => netAmount(cents(-1), ZERO, ZERO), 'NEGATIVE_NOT_ALLOWED');
    expectCode(() => netAmount(cents(100), cents(-1), ZERO), 'NEGATIVE_NOT_ALLOWED');
    expectCode(() => netAmount(cents(100), ZERO, cents(-1)), 'NEGATIVE_NOT_ALLOWED');
  });

  it('rejeita desconto maior que base + encargos', () => {
    expectCode(() => netAmount(cents(10000), cents(500), cents(10501)), 'NEGATIVE_RESULT');
  });

  it('rejeita overflow', () => {
    expectCode(() => netAmount(cents(MAX_CENTS), cents(1), ZERO), 'OUT_OF_SAFE_RANGE');
  });
});

