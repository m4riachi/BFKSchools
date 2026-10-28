import { inject } from '@adonisjs/core'
import type { DateTime } from 'luxon'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type School from '#models/school'
import type WeeklyMenu from '#models/weekly_menu'
import type MenuItem from '#models/menu_item'
import type Meal from '#models/meal'
import HolidayCalendar from '#services/holiday_calendar'
import SchoolSettingsService from '#services/school_settings_service'
import {
  addDays,
  atLocalTime,
  isIsoDate,
  isoWeekday,
  isSchoolDay,
  type IsoDate,
} from '#support/dates'
import { schoolZone } from '#support/menu_display'

/** State of one weekday column of the builder. */
export type MenuDayState = 'open' | 'holiday' | 'not_school_day'

export type MenuDay = {
  date: IsoDate
  weekday: number
  state: MenuDayState
  /** Names of the holidays of that date (several may share a date). */
  holidayNames: string[]
}

/** Something that prevents scheduling/publishing (codes → `menus.issues.<code>`). */
export type MenuIssue =
  | { code: 'missing_times' }
  | { code: 'deadline_before_publish' }
  | { code: 'deadline_after_week' }
  | { code: 'no_open_day' }
  | { code: 'missing_default'; date: IsoDate }
  | { code: 'items_on_closed_day'; date: IsoDate }
  | { code: 'meal_unavailable'; date: IsoDate; mealId: number }

type ItemWithMeal = Pick<MenuItem, 'date' | 'mealType' | 'isDefault' | 'mealId'> & {
  meal?: Pick<Meal, 'isActive' | 'deletedAt'> | null
}

/**
 * Years a menu week may fall in. Weeks outside this window are a 404
 * everywhere (`isMonday`), so date arithmetic around them (previous/next
 * week, the week before for publish times) can never leave PostgreSQL's or
 * Luxon's date range. A fixed window is simpler than "school year ± n" and
 * doesn't depend on the school row.
 */
export const MENU_YEAR_MIN = 2000
export const MENU_YEAR_MAX = 2100

/** True when `value` is a Monday 'YYYY-MM-DD' of a year in the menu window. */
export function isMonday(value: unknown): value is IsoDate {
  if (!isIsoDate(value)) return false
  const year = Number(value.slice(0, 4))
  return year >= MENU_YEAR_MIN && year <= MENU_YEAR_MAX && isoWeekday(value) === 1
}

/**
 * Calendar facts about a menu week: which days can carry meals (school
 * weekday, inside the school year, not a holiday — via HolidayCalendar),
 * the default publish/deadline instants from the school settings, and the
 * readiness rules checked before a menu can be scheduled or published.
 */
@inject()
export default class MenuCalendar {
  constructor(
    protected holidays: HolidayCalendar,
    protected settings: SchoolSettingsService
  ) {}

  /**
   * Columns of the builder: every school weekday of the week (Mon–Fri by
   * default), each flagged open / holiday / outside the school year.
   */
  async days(school: School, weekStart: IsoDate, client?: QueryClientContract): Promise<MenuDay[]> {
    const weekdays = [...school.schoolDays].sort((a, b) => a - b)
    const holidays = await this.holidays.holidaysBetween(
      school.id,
      weekStart,
      addDays(weekStart, 6),
      client
    )
    const calendar = {
      schoolDays: school.schoolDays,
      schoolYearStart: school.schoolYearStart,
      schoolYearEnd: school.schoolYearEnd,
    }
    return weekdays.map((weekday) => {
      const date = addDays(weekStart, weekday - 1)
      const holidayNames = holidays.filter((h) => h.date === date).map((h) => h.name)
      const state: MenuDayState = !isSchoolDay(date, calendar)
        ? 'not_school_day'
        : holidayNames.length
          ? 'holiday'
          : 'open'
      return { date, weekday, state, holidayNames }
    })
  }

  /** Dates of the week that can receive menu items. */
  async openDates(school: School, weekStart: IsoDate, client?: QueryClientContract) {
    const days = await this.days(school, weekStart, client)
    return new Set(days.filter((day) => day.state === 'open').map((day) => day.date))
  }

  /**
   * Default `publish_at` / `order_deadline_at` of a week (D3/D4): the
   * configured weekday **of the week before** at the configured wall-clock
   * time in the school's IANA zone (never a fixed offset). `valid` is false
   * when the settings would put the deadline at or before publication.
   */
  defaultTimes(school: School, weekStart: IsoDate) {
    const settings = this.settings.get(school)
    const zone = schoolZone(school)
    const publishAt = atLocalTime(
      addDays(weekStart, settings.publish_weekday - 8),
      settings.publish_time,
      zone
    )
    const orderDeadlineAt = atLocalTime(
      addDays(weekStart, settings.deadline_weekday - 8),
      settings.deadline_time,
      zone
    )
    return { publishAt, orderDeadlineAt, valid: orderDeadlineAt > publishAt }
  }

  /** Midnight (school zone) after the last day of the menu's week. */
  weekEndsAt(school: School, weekStart: IsoDate): DateTime {
    return atLocalTime(addDays(weekStart, 7), '00:00', schoolZone(school))
  }

  /**
   * Rules a menu must satisfy before it is scheduled or published:
   * publish/deadline set, deadline after publish and before the week ends,
   * at least one open (non-holiday school) day with meals, exactly one
   * default on every open day that has subscription meals, no items left on
   * a day that became a holiday, and only active, non-deleted meals.
   */
  readiness(
    school: School,
    menu: Pick<WeeklyMenu, 'weekStart' | 'publishAt' | 'orderDeadlineAt'>,
    days: MenuDay[],
    items: ItemWithMeal[]
  ): MenuIssue[] {
    const issues: MenuIssue[] = []
    if (!menu.publishAt || !menu.orderDeadlineAt) {
      issues.push({ code: 'missing_times' })
    } else {
      if (menu.orderDeadlineAt <= menu.publishAt) issues.push({ code: 'deadline_before_publish' })
      if (menu.orderDeadlineAt >= this.weekEndsAt(school, menu.weekStart)) {
        issues.push({ code: 'deadline_after_week' })
      }
    }

    const open = new Set(days.filter((day) => day.state === 'open').map((day) => day.date))
    const byDate = new Map<IsoDate, ItemWithMeal[]>()
    for (const item of items) {
      const list = byDate.get(item.date) ?? []
      list.push(item)
      byDate.set(item.date, list)
    }

    let openDaysWithMeals = 0
    for (const date of [...byDate.keys()].sort()) {
      const list = byDate.get(date)!
      if (!open.has(date)) {
        issues.push({ code: 'items_on_closed_day', date })
        continue
      }
      openDaysWithMeals += 1
      const subscriptions = list.filter((item) => item.mealType === 'subscription')
      const defaults = subscriptions.filter((item) => item.isDefault).length
      if (subscriptions.length > 0 && defaults !== 1) issues.push({ code: 'missing_default', date })
      for (const item of list) {
        if (item.meal && (!item.meal.isActive || item.meal.deletedAt)) {
          issues.push({ code: 'meal_unavailable', date, mealId: item.mealId })
        }
      }
    }
    if (openDaysWithMeals === 0) issues.push({ code: 'no_open_day' })
    return issues
  }
}
