import { DateTime } from 'luxon'
import i18nManager from '@adonisjs/i18n/services/main'
import type School from '#models/school'
import { addDays, isoWeekday, type IsoDate } from '#support/dates'
import { APP_TIMEZONE } from '#support/time'

/**
 * Display helpers for weekly menus (back-office, emails, later the parent
 * portal). Business days are formatted as pure dates (UTC, no shift);
 * instants in the school's IANA zone.
 */

/** First and last school day of the week (Monday-based), or the full week. */
export function weekBounds(weekStart: IsoDate, schoolDays: readonly number[]) {
  const days = [...schoolDays].sort((a, b) => a - b)
  const first = days[0] ?? 1
  const last = days[days.length - 1] ?? 7
  return { first: addDays(weekStart, first - 1), last: addDays(weekStart, last - 1) }
}

function formatDay(iso: IsoDate, locale: string, options: Intl.DateTimeFormatOptions) {
  return DateTime.fromISO(iso, { zone: 'utc' }).setLocale(locale).toLocaleString(options)
}

/** "du 23 au 27 novembre 2026" / "November 23 – 27, 2026". */
export function weekRangeLabel(
  weekStart: IsoDate,
  schoolDays: readonly number[],
  locale: string
): string {
  const { first, last } = weekBounds(weekStart, schoolDays)
  return i18nManager.locale(locale).t('menus.week_range', {
    start: formatDay(first, locale, { day: 'numeric', month: 'long' }),
    end: formatDay(last, locale, { day: 'numeric', month: 'long', year: 'numeric' }),
  })
}

/** "dimanche 22 novembre à 20:00" — an instant in the school's zone. */
export function instantLabel(instant: DateTime, locale: string, zone: string = APP_TIMEZONE) {
  return instant.setZone(zone).setLocale(locale).toLocaleString({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** ISO weekday of a menu day (1 = Monday). */
export function menuWeekday(date: IsoDate) {
  return isoWeekday(date)
}

/** IANA zone of a school (falls back to the app zone). */
export function schoolZone(school: Pick<School, 'timezone'>) {
  return school.timezone || APP_TIMEZONE
}
