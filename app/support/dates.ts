import { DateTime } from 'luxon'
import { APP_TIMEZONE } from '#support/time'

/**
 * Helpers for business days. A business day is a plain 'YYYY-MM-DD' string
 * (PostgreSQL `date`), never a timestamp. Calendar arithmetic is done in UTC
 * on purpose: a pure date has no time zone, so DST changes cannot shift it.
 */

export type IsoDate = string

/** ISO weekday numbers: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parse(iso: IsoDate): DateTime {
  const value = DateTime.fromISO(iso, { zone: 'utc' })
  if (!ISO_DATE_RE.test(iso) || !value.isValid) {
    throw new TypeError(`Invalid ISO date "${iso}"`)
  }
  return value
}

export function isIsoDate(value: unknown): value is IsoDate {
  return (
    typeof value === 'string' &&
    ISO_DATE_RE.test(value) &&
    DateTime.fromISO(value, { zone: 'utc' }).isValid
  )
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return parse(iso).plus({ days }).toISODate()!
}

export function isoWeekday(iso: IsoDate): IsoWeekday {
  return parse(iso).weekday as IsoWeekday
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: IsoDate): IsoDate {
  return parse(iso).startOf('week').toISODate()!
}

/** Every date from `from` to `to`, both included. */
export function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = []
  for (let current = from; current <= to; current = addDays(current, 1)) {
    dates.push(current)
  }
  return dates
}

/** Number of days from `from` to `to` (negative when `to` is earlier). */
export function diffInDays(from: IsoDate, to: IsoDate): number {
  return parse(to).diff(parse(from), 'days').days
}

export type SchoolCalendar = {
  schoolDays: number[]
  schoolYearStart?: IsoDate | null
  schoolYearEnd?: IsoDate | null
}

/**
 * True when `iso` falls on one of the school's weekdays and, when given,
 * inside the school year. Holidays are checked separately (Phase 4).
 */
export function isSchoolDay(iso: IsoDate, calendar: SchoolCalendar): boolean {
  if (!calendar.schoolDays.includes(isoWeekday(iso))) return false
  if (calendar.schoolYearStart && iso < calendar.schoolYearStart) return false
  if (calendar.schoolYearEnd && iso > calendar.schoolYearEnd) return false
  return true
}

/**
 * The instant at which a wall-clock time ('HH:mm') happens on a business day,
 * in the given IANA zone.
 */
export function atLocalTime(iso: IsoDate, time: string, zone: string = APP_TIMEZONE): DateTime {
  const value = DateTime.fromISO(`${iso}T${time}`, { zone })
  if (!value.isValid) throw new TypeError(`Invalid date/time "${iso} ${time}"`)
  return value
}
