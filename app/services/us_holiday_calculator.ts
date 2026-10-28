import { addDays, isoWeekday, type IsoDate, type IsoWeekday } from '#support/dates'
import {
  MOROCCAN_FIXED_HOLIDAY_RULES,
  US_FEDERAL_HOLIDAY_RULES,
  type HolidayRule,
} from '#config/holidays'

/**
 * US federal holidays computed by rule (brief §5.3: no hard-coded dates).
 * Pure functions: no I/O, no clock, no time zone (dates are 'YYYY-MM-DD').
 */

const pad = (value: number) => String(value).padStart(2, '0')

/** 'YYYY-MM-DD' of a fixed day (month 1–12). Throws on impossible dates. */
export function fixedDate(year: number, month: number, day: number): IsoDate {
  const iso = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError(`Invalid date ${iso}`)
  }
  return iso
}

/** Number of days in a month (month 1–12). */
function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * The n-th given weekday of a month, e.g. the 4th Thursday of November:
 * `nthWeekdayOfMonth(2026, 11, 4, 4)`. Weekdays are ISO (1 = Monday).
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: IsoWeekday,
  n: number
): IsoDate {
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new RangeError(`Invalid n ${n}`)
  const first = fixedDate(year, month, 1)
  const offset = (weekday - isoWeekday(first) + 7) % 7
  const day = 1 + offset + (n - 1) * 7
  if (day > daysInMonth(year, month)) {
    throw new RangeError(`No ${n}th weekday ${weekday} in ${year}-${pad(month)}`)
  }
  return fixedDate(year, month, day)
}

/** The last given weekday of a month, e.g. the last Monday of May. */
export function lastWeekdayOfMonth(year: number, month: number, weekday: IsoWeekday): IsoDate {
  const last = fixedDate(year, month, daysInMonth(year, month))
  const offset = (isoWeekday(last) - weekday + 7) % 7
  return addDays(last, -offset)
}

/**
 * Federal "observed" rule (5 U.S.C. 6103(b)): a holiday falling on a
 * Saturday is observed the Friday before, one on a Sunday the Monday after.
 */
export function observedDate(date: IsoDate): IsoDate {
  const weekday = isoWeekday(date)
  if (weekday === 6) return addDays(date, -1)
  if (weekday === 7) return addDays(date, 1)
  return date
}

export type ComputedHoliday = {
  /** Stable idempotency key, e.g. `us_thanksgiving_2026` (year of the actual date). */
  ruleKey: string
  code: string
  nameFr: string
  nameEn: string
  /** The day the school is closed (after the observed rule). */
  date: IsoDate
  /** The calendar date of the holiday itself (differs from `date` when observed). */
  actualDate: IsoDate
  observed: boolean
}

export function computeRule(
  rule: HolidayRule,
  year: number,
  prefix: string,
  options: { observedRule: boolean }
): ComputedHoliday {
  let actualDate: IsoDate
  switch (rule.kind) {
    case 'fixed':
      actualDate = fixedDate(year, rule.month, rule.day)
      break
    case 'nth_weekday':
      actualDate = nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.n)
      break
    case 'last_weekday':
      actualDate = lastWeekdayOfMonth(year, rule.month, rule.weekday)
      break
    case 'nth_weekday_plus':
      actualDate = addDays(nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.n), rule.plusDays)
      break
  }
  const date = options.observedRule && rule.kind === 'fixed' ? observedDate(actualDate) : actualDate
  return {
    ruleKey: `${prefix}_${rule.code}_${year}`,
    code: rule.code,
    nameFr: rule.nameFr,
    nameEn: rule.nameEn,
    date,
    actualDate,
    observed: date !== actualDate,
  }
}

/** Every US federal holiday of the school calendar for one calendar year. */
export function usFederalHolidays(year: number): ComputedHoliday[] {
  return rulesForYear(US_FEDERAL_HOLIDAY_RULES, year, 'us', true)
}

/** Moroccan fixed-date national holidays of one calendar year (no observed rule). */
export function moroccanFixedHolidays(year: number): ComputedHoliday[] {
  return rulesForYear(MOROCCAN_FIXED_HOLIDAY_RULES, year, 'ma', false)
}

function rulesForYear(
  rules: readonly HolidayRule[],
  year: number,
  prefix: string,
  observedRule: boolean
): ComputedHoliday[] {
  return rules
    .filter((rule) => rule.sinceYear === undefined || year >= rule.sinceYear)
    .map((rule) => computeRule(rule, year, prefix, { observedRule }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Holidays whose closed day falls inside [from, to] (both included). The year
 * after `to` is also computed: New Year's Day on a Saturday is observed on
 * 31 December of the previous year (e.g. 2028-01-01 → 2027-12-31).
 */
export function usFederalHolidaysBetween(from: IsoDate, to: IsoDate): ComputedHoliday[] {
  return between(usFederalHolidays, from, to)
}

export function moroccanFixedHolidaysBetween(from: IsoDate, to: IsoDate): ComputedHoliday[] {
  return between(moroccanFixedHolidays, from, to)
}

function between(
  forYear: (year: number) => ComputedHoliday[],
  from: IsoDate,
  to: IsoDate
): ComputedHoliday[] {
  const first = Number(from.slice(0, 4))
  const last = Number(to.slice(0, 4)) + 1
  const result: ComputedHoliday[] = []
  for (let year = first; year <= last; year++) {
    for (const holiday of forYear(year)) {
      if (holiday.date >= from && holiday.date <= to) result.push(holiday)
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code))
}
