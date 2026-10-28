import { DateTime } from 'luxon'
import { MENU_YEAR_MAX, MENU_YEAR_MIN } from '#services/menu_calendar'
import { addDays, diffInDays, isIsoDate, weekStart, type IsoDate } from '#support/dates'

export type ReportPeriod = 'day' | 'week' | 'month' | 'custom'

export type PeriodInput = {
  period?: ReportPeriod
  date?: string
  from?: string
  to?: string
}

export type ResolvedPeriod = { period: ReportPeriod; date: IsoDate; from: IsoDate; to: IsoDate }

/** Why a period is refused (translated under `reports.errors.<code>`). */
export type PeriodError = 'invalid_date' | 'range_order' | 'range_too_long'

/** A report date inside the supported window (years 2000–2100, like menu weeks). */
export function isReportDate(value: unknown): value is IsoDate {
  if (!isIsoDate(value)) return false
  const year = Number(value.slice(0, 4))
  return year >= MENU_YEAR_MIN && year <= MENU_YEAR_MAX
}

/** The report date of a page (`?date=`), or `today` when missing/invalid. */
export function reportDate(value: unknown, today: IsoDate): IsoDate {
  return isReportDate(value) ? value : today
}

function lastDayOfMonth(date: IsoDate): IsoDate {
  return DateTime.fromISO(date, { zone: 'utc' }).endOf('month').toISODate()!
}

/**
 * Resolves the export period: the day, the Monday–Sunday week or the
 * calendar month of `date` (default today), or a custom `from`–`to` range
 * of at most `maxDays` days (both included).
 */
export function resolvePeriod(
  input: PeriodInput,
  today: IsoDate,
  maxDays: number
): ResolvedPeriod | { error: PeriodError } {
  const period = input.period ?? 'day'
  if (period === 'custom') {
    if (!isReportDate(input.from) || !isReportDate(input.to)) return { error: 'invalid_date' }
    if (input.to < input.from) return { error: 'range_order' }
    if (diffInDays(input.from, input.to) + 1 > maxDays) return { error: 'range_too_long' }
    return { period, date: input.from, from: input.from, to: input.to }
  }
  if (input.date !== undefined && !isReportDate(input.date)) return { error: 'invalid_date' }
  const date = input.date ?? today
  if (period === 'week') {
    const monday = weekStart(date)
    return { period, date, from: monday, to: addDays(monday, 6) }
  }
  if (period === 'month') {
    return { period, date, from: `${date.slice(0, 8)}01`, to: lastDayOfMonth(date) }
  }
  return { period: 'day', date, from: date, to: date }
}
