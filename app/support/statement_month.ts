import { DateTime } from 'luxon'
import type { IsoDate } from '#support/dates'

/**
 * Statement months ('YYYY-MM'). A month is a pure calendar month (no time
 * zone): its first and last day are business days ('YYYY-MM-DD').
 *
 * Window: from January 2000 (same lower bound as the menu weeks) up to the
 * month after the current one (orders can exist for next month as soon as
 * a menu crossing the month end is published). Anything else is refused.
 */
export type StatementMonth = string

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
export const STATEMENT_MIN_MONTH = '2000-01'

function parse(month: StatementMonth): DateTime {
  return DateTime.fromISO(`${month}-01`, { zone: 'utc' })
}

export function isMonthString(value: unknown): value is StatementMonth {
  return typeof value === 'string' && MONTH_RE.test(value)
}

/** Month containing a business day. */
export function monthOf(day: IsoDate): StatementMonth {
  return day.slice(0, 7)
}

export function addMonths(month: StatementMonth, months: number): StatementMonth {
  return parse(month).plus({ months }).toFormat('yyyy-MM')
}

/** Last month a statement can be opened for (the month after `today`'s). */
export function maxStatementMonth(today: IsoDate): StatementMonth {
  return addMonths(monthOf(today), 1)
}

/** True when `value` is a 'YYYY-MM' inside the allowed window. */
export function isStatementMonth(value: unknown, today: IsoDate): value is StatementMonth {
  return isMonthString(value) && value >= STATEMENT_MIN_MONTH && value <= maxStatementMonth(today)
}

/** First and last day of the month (both included). */
export function monthRange(month: StatementMonth): { from: IsoDate; to: IsoDate } {
  const start = parse(month)
  return { from: start.toISODate()!, to: start.endOf('month').toISODate()! }
}

/**
 * The current month (or a later one) is **provisional**: orders can still
 * change. Earlier months are closed (D23: staff can only change dates of
 * the current month or later, parents only upcoming days).
 */
export function isProvisional(month: StatementMonth, today: IsoDate): boolean {
  return month >= monthOf(today)
}

/** "novembre 2026" / "November 2026". */
export function monthLabel(month: StatementMonth, locale: string): string {
  return parse(month).setLocale(locale).toLocaleString({ month: 'long', year: 'numeric' })
}

/** Months offered by the pickers, newest first (`count` months up to the max). */
export function monthChoices(today: IsoDate, count = 13): StatementMonth[] {
  const last = maxStatementMonth(today)
  const months: StatementMonth[] = []
  for (let index = 0; index < count; index += 1) {
    const month = addMonths(last, -index)
    if (month < STATEMENT_MIN_MONTH) break
    months.push(month)
  }
  return months
}
