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

/**
 * Week label without repeating what both ends share:
 * - same month: "du 23 au 27 novembre 2026" / "November 23 – 27, 2026";
 * - same year: "du 30 novembre au 4 décembre 2026" / "November 30 – December 4, 2026";
 * - otherwise: "du 28 décembre 2026 au 1 janvier 2027" / "December 28, 2026 – January 1, 2027".
 */
export function weekRangeLabel(
  weekStart: IsoDate,
  schoolDays: readonly number[],
  locale: string
): string {
  const { first, last } = weekBounds(weekStart, schoolDays)
  const i18n = i18nManager.locale(locale)
  const start = DateTime.fromISO(first, { zone: 'utc' }).setLocale(locale)
  const end = DateTime.fromISO(last, { zone: 'utc' }).setLocale(locale)
  if (first === last) {
    return i18n.t('menus.week_range_single', {
      date: formatDay(first, locale, { day: 'numeric', month: 'long', year: 'numeric' }),
    })
  }
  if (start.year === end.year && start.month === end.month) {
    return i18n.t('menus.week_range_same_month', {
      // Strings, not numbers: ICU would group digits ("2,026").
      startDay: String(start.day),
      endDay: String(end.day),
      month: start.toFormat('LLLL'),
      year: String(start.year),
    })
  }
  const sameYear = start.year === end.year
  return i18n.t('menus.week_range', {
    start: formatDay(
      first,
      locale,
      sameYear
        ? { day: 'numeric', month: 'long' }
        : { day: 'numeric', month: 'long', year: 'numeric' }
    ),
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

/** "lundi 23 novembre" / "Monday, November 23" — a business day, no zone shift. */
export function dayLabel(iso: IsoDate, locale: string): string {
  return formatDay(iso, locale, { weekday: 'long', day: 'numeric', month: 'long' })
}
