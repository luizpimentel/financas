/**
 * Utilitário puro e determinístico para representação e navegação de mês/ano.
 *
 * Evita cálculos frágeis com `new Date()` (que podem pular meses em dias 29/30/31
 * ou deslocar datas por fuso horário).
 */

export type MonthNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface MonthPeriod {
  readonly year: number;
  readonly month: MonthNumber;
}

export const MONTH_NAMES_PT_BR: readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
] = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

export const MONTH_SHORT_NAMES_PT_BR: readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
] = [
  'Jan.',
  'Fev.',
  'Mar.',
  'Abr.',
  'Mai.',
  'Jun.',
  'Jul.',
  'Ago.',
  'Set.',
  'Out.',
  'Nov.',
  'Dez.',
] as const;

export const MIN_SUPPORTED_YEAR = 1970;
export const MAX_SUPPORTED_YEAR = 2100;

export function isValidMonthNumber(value: number): value is MonthNumber {
  return Number.isInteger(value) && value >= 1 && value <= 12;
}

export function createMonthPeriod(year: number, month: number): MonthPeriod {
  if (!Number.isInteger(year) || year < MIN_SUPPORTED_YEAR || year > MAX_SUPPORTED_YEAR) {
    throw new RangeError(
      `Ano inválido: ${year}. Deve ser um inteiro entre ${MIN_SUPPORTED_YEAR} e ${MAX_SUPPORTED_YEAR}.`,
    );
  }
  if (!isValidMonthNumber(month)) {
    throw new RangeError(`Mês inválido: ${month}. Deve ser um inteiro entre 1 e 12.`);
  }
  return { year, month };
}

/**
 * Avança ou retrocede `deltaMonths` meses a partir de `period` usando aritmética inteira.
 */
export function stepMonthPeriod(period: MonthPeriod, deltaMonths: number): MonthPeriod {
  if (!Number.isInteger(deltaMonths)) {
    throw new RangeError('O deslocamento de meses deve ser um número inteiro.');
  }
  const zeroBasedTotal = period.year * 12 + (period.month - 1) + deltaMonths;
  const nextYear = Math.floor(zeroBasedTotal / 12);
  const remainder = ((zeroBasedTotal % 12) + 12) % 12;
  const nextMonth = (remainder + 1) as MonthNumber;

  return createMonthPeriod(nextYear, nextMonth);
}

export function getMonthNamePtBR(month: MonthNumber): string {
  return MONTH_NAMES_PT_BR[month - 1] ?? 'Janeiro';
}

export interface FormatMonthPeriodOptions {
  /** Se true (padrão), exibe sempre o ano junto ao mês (ex.: "Novembro de 2026"). */
  readonly alwaysShowYear?: boolean;
  /** Ano de referência para ocultar o ano quando `alwaysShowYear` for false. */
  readonly referenceYear?: number;
  /** Separador entre mês e ano (padrão: " "). Ex.: ", " -> "Dezembro, 2026". */
  readonly separator?: string;
}

export function formatMonthPeriod(
  period: MonthPeriod,
  options?: FormatMonthPeriodOptions,
): string {
  const monthName = getMonthNamePtBR(period.month);
  const alwaysShowYear = options?.alwaysShowYear ?? true;
  const separator = options?.separator ?? ' ';

  if (!alwaysShowYear && options?.referenceYear === period.year) {
    return monthName;
  }

  return `${monthName}${separator}${period.year}`;
}

