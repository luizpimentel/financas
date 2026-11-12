/**
 * Domínio monetário — aritmética exclusivamente em centavos inteiros (BRL).
 *
 * Regras (AGENTS.md §3):
 *  - Nenhum cálculo com ponto flutuante. Valores trafegam como inteiros em centavos.
 *  - Todo valor deve satisfazer `Number.isSafeInteger`; qualquer resultado fora do
 *    intervalo seguro é rejeitado (nunca arredondado silenciosamente).
 *  - Conversão de texto -> centavos é feita por análise de string (BigInt),
 *    jamais por `parseFloat(v) * 100`.
 *
 * Esta camada é pura (sem I/O) e deve espelhar as regras aplicadas no PostgreSQL.
 */

declare const centsBrand: unique symbol;

/** Quantia em centavos de real: inteiro seguro, possivelmente negativo ou zero. */
export type Cents = number & { readonly [centsBrand]: true };

export const MAX_CENTS = Number.MAX_SAFE_INTEGER;
export const MIN_CENTS = Number.MIN_SAFE_INTEGER;

export type MoneyErrorCode =
  | 'NOT_AN_INTEGER'
  | 'OUT_OF_SAFE_RANGE'
  | 'INVALID_FORMAT'
  | 'EMPTY_INPUT'
  | 'TOO_MANY_DECIMALS'
  | 'NEGATIVE_NOT_ALLOWED'
  | 'NEGATIVE_RESULT';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

/** Valida e marca um número como `Cents`. Rejeita não inteiros, NaN, Infinity e fora do intervalo seguro. */
export function cents(value: number): Cents {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new MoneyError('NOT_AN_INTEGER', 'Centavos devem ser um número inteiro.');
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError('OUT_OF_SAFE_RANGE', 'Valor fora do intervalo de inteiros seguros.');
  }
  // Normaliza -0 para 0.
  return (value === 0 ? 0 : value) as Cents;
}

export const ZERO: Cents = cents(0);

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function add(a: Cents, b: Cents): Cents {
  return cents(a + b);
}

export function subtract(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

export function negate(a: Cents): Cents {
  return cents(-a);
}

export function abs(a: Cents): Cents {
  return cents(Math.abs(a));
}

export function sum(values: readonly Cents[]): Cents {
  let total: Cents = ZERO;
  for (const v of values) {
    total = add(total, v);
  }
  return total;
}

export function compare(a: Cents, b: Cents): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Valor líquido de um lançamento: `base + encargos - desconto` (AGENTS.md / plano §17).
 * Todos os componentes devem ser >= 0 e o resultado não pode ser negativo.
 */
export function netAmount(base: Cents, fees: Cents, discount: Cents): Cents {
  if (base < 0 || fees < 0 || discount < 0) {
    throw new MoneyError(
      'NEGATIVE_NOT_ALLOWED',
      'Valor base, encargos e desconto não podem ser negativos.',
    );
  }
  const result = subtract(add(base, fees), discount);
  if (result < 0) {
    throw new MoneyError('NEGATIVE_RESULT', 'O desconto não pode exceder o valor base mais encargos.');
  }
  return result;
}

/**
 * Converte texto monetário brasileiro em centavos.
 *
 * Aceita (com ou sem "R$", espaços e sinal "-" antes do número ou do "R$"):
 *  - "1.306,00", "1306,00", "1306", "0,5" (=> 50), "12,5" (=> 1250)
 *  - Pontos como separador de milhar apenas em grupos de 3 dígitos ("1.234.567,89").
 *
 * Regras de ambiguidade: um valor apenas com pontos ("1.234") é interpretado como
 * milhar (R$ 1.234,00), seguindo a convenção pt-BR. Formato internacional ("1,234.56")
 * e mais de 2 casas decimais são rejeitados — nunca arredondados.
 */
export function parseBRL(input: string): Cents {
  if (typeof input !== 'string') {
    throw new MoneyError('INVALID_FORMAT', 'Entrada monetária deve ser texto.');
  }

  let text = input.trim().replace(/\u00a0/g, ' ');
  if (text === '') {
    throw new MoneyError('EMPTY_INPUT', 'Informe um valor.');
  }

  let negative = false;
  if (text.startsWith('-') || text.startsWith('\u2212')) {
    negative = true;
    text = text.slice(1).trimStart();
  }
  if (/^R\$/i.test(text)) {
    text = text.slice(2).trimStart();
  }
  if (!negative && (text.startsWith('-') || text.startsWith('\u2212'))) {
    negative = true;
    text = text.slice(1).trimStart();
  }
  if (text === '') {
    throw new MoneyError('EMPTY_INPUT', 'Informe um valor.');
  }

  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d*))?$/.exec(text);
  if (!match) {
    throw new MoneyError('INVALID_FORMAT', `Valor monetário inválido: "${input}".`);
  }

  const integerPart = (match[1] ?? '').replace(/\./g, '');
  const fraction = match[2] ?? '';
  if (match[0].endsWith(',') ) {
    throw new MoneyError('INVALID_FORMAT', `Valor monetário inválido: "${input}".`);
  }
  if (fraction.length > 2) {
    throw new MoneyError('TOO_MANY_DECIMALS', 'Valores em BRL aceitam no máximo 2 casas decimais.');
  }

  const centsText = integerPart + fraction.padEnd(2, '0');
  const magnitude = BigInt(centsText);
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (magnitude > limit) {
    throw new MoneyError('OUT_OF_SAFE_RANGE', 'Valor fora do intervalo de inteiros seguros.');
  }

  const value = Number(magnitude);
  return cents(negative ? -value : value);
}

/** Formata centavos em BRL por manipulação de inteiros/strings: "R$ 1.306,00", "-R$ 40,00". */
export function formatBRL(value: Cents): string {
  const negative = value < 0;
  const magnitude = BigInt(value) * (negative ? -1n : 1n);
  const digits = magnitude.toString().padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${grouped},${fraction}`;
}

