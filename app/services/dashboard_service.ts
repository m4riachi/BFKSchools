import { inject } from '@adonisjs/core'
import type School from '#models/school'
import WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import HolidayCalendar, { type EffectiveHoliday } from '#services/holiday_calendar'
import MenuCalendar from '#services/menu_calendar'
import ProductionReportService, {
  type Amounts,
  type MissingSelection,
  type ProductionSheet,
} from '#services/production_report_service'
import {
  addDays,
  isSchoolDay,
  isoWeekday,
  weekStart as mondayOf,
  type IsoDate,
} from '#support/dates'
import type { WeeklyMenuStatus } from '#enums/menus'

/** How far ahead the dashboard lists holidays (brief §5.7). */
export const UPCOMING_HOLIDAY_DAYS = 30

export type DayState = 'open' | 'holiday' | 'not_school_day' | 'no_menu'

export type DashboardDay = {
  date: IsoDate
  /** `today`, `tomorrow`, or `next_school_day` (tomorrow is not a school day). */
  kind: 'today' | 'tomorrow' | 'next_school_day'
  state: DayState
  holidayNames: string[]
  production: ProductionSheet
  /** Only for open days (a published menu with meals that day). */
  missing: MissingSelection | null
}

export type HolidayRange = { from: IsoDate; to: IsoDate; name: string; days: number }

export type NextWeek = {
  weekStart: IsoDate
  status: WeeklyMenuStatus | 'none'
  publishAt: string | null
  orderDeadlineAt: string | null
  /** Minutes until the order deadline (0 once passed, null without a deadline). */
  minutesToDeadline: number | null
  /** Open days with meals (only once published). */
  openDays: number
  selection: { children: number; complete: number; started: number; percent: number } | null
}

export type Dashboard = {
  today: IsoDate
  days: DashboardDay[]
  nextWeek: NextWeek
  holidays: HolidayRange[]
  monthToDate: (Amounts & { from: IsoDate; to: IsoDate }) | null
}

/**
 * Back-office dashboard (brief §5.7), built from ProductionReportService
 * with a bounded number of queries (≈ 16 whatever the number of children:
 * 5 per day × 2, holidays 1, menu days 1, next-week menu 1 + items 1 +
 * selection 1, month-to-date 1). "Now" comes from Clock (school zone).
 */
@inject()
export default class DashboardService {
  constructor(
    protected clock: Clock,
    protected reports: ProductionReportService,
    protected holidays: HolidayCalendar,
    protected calendar: MenuCalendar
  ) {}

  /** First school weekday after `date` (holidays are shown, not skipped). */
  protected nextSchoolDay(school: School, date: IsoDate): IsoDate {
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = addDays(date, offset)
      if (school.schoolDays.includes(isoWeekday(candidate))) return candidate
    }
    return addDays(date, 1)
  }

  async build(school: School, options: { amounts: boolean }): Promise<Dashboard> {
    const today = this.clock.today()
    const next = this.nextSchoolDay(school, today)
    const calendar = {
      schoolDays: school.schoolDays,
      schoolYearStart: school.schoolYearStart,
      schoolYearEnd: school.schoolYearEnd,
    }

    const holidayRows = await this.holidays.holidaysBetween(
      school.id,
      today,
      addDays(today, Math.max(UPCOMING_HOLIDAY_DAYS, 7))
    )
    const menuDays = await this.reports.menuDays(school.id, [today, next])

    const days: DashboardDay[] = []
    for (const [date, kind] of [
      [today, 'today'],
      [next, next === addDays(today, 1) ? 'tomorrow' : 'next_school_day'],
    ] as const) {
      const holidayNames = holidayRows.filter((row) => row.date === date).map((row) => row.name)
      const state: DayState = !isSchoolDay(date, calendar)
        ? 'not_school_day'
        : holidayNames.length
          ? 'holiday'
          : menuDays.has(date)
            ? 'open'
            : 'no_menu'
      days.push({
        date,
        kind,
        state,
        holidayNames,
        production: await this.reports.production(school.id, date),
        missing: state === 'open' ? await this.reports.missingSelections(school.id, date) : null,
      })
    }

    const monthStart = `${today.slice(0, 8)}01`
    return {
      today,
      days,
      nextWeek: await this.nextWeek(school, today),
      holidays: this.ranges(
        school,
        holidayRows.filter((row) => row.date <= addDays(today, UPCOMING_HOLIDAY_DAYS))
      ),
      monthToDate: options.amounts
        ? {
            from: monthStart,
            to: today,
            ...(await this.reports.amounts(school.id, monthStart, today)),
          }
        : null,
    }
  }

  protected async nextWeek(school: School, today: IsoDate): Promise<NextWeek> {
    const weekStart = addDays(mondayOf(today), 7)
    const menu = await WeeklyMenu.query()
      .where('school_id', school.id)
      .where('week_start', weekStart)
      .first()
    const now = this.clock.now()
    const defaults = this.calendar.defaultTimes(school, weekStart)
    const deadline = menu ? menu.orderDeadlineAt : defaults.orderDeadlineAt
    const publishAt = menu ? menu.publishAt : defaults.publishAt

    let openDays = 0
    let selection: NextWeek['selection'] = null
    if (menu && (menu.status === 'published' || menu.status === 'closed')) {
      const open = await this.calendar.openDates(school, weekStart)
      const withMeals = await this.reports.menuDays(school.id, [...open].sort())
      const dates = [...withMeals].sort()
      openDays = dates.length
      const counts = await this.reports.weekSelection(school.id, dates)
      selection = {
        ...counts,
        percent: counts.children ? Math.floor((counts.complete * 100) / counts.children) : 0,
      }
    }

    return {
      weekStart,
      status: menu?.status ?? 'none',
      publishAt: publishAt?.toISO() ?? null,
      orderDeadlineAt: deadline?.toISO() ?? null,
      minutesToDeadline: deadline
        ? Math.max(0, Math.floor(deadline.diff(now, 'minutes').minutes))
        : null,
      openDays,
      selection,
    }
  }

  /**
   * Consecutive holidays with the same name become one range ("Winter
   * break 21 Dec – 1 Jan"): ranges are stored for school days only, so two
   * rows are merged when no school day separates them.
   */
  protected ranges(school: School, rows: EffectiveHoliday[]): HolidayRange[] {
    const ranges: HolidayRange[] = []
    for (const row of rows) {
      const last = ranges.at(-1)
      if (last && last.name === row.name && this.adjacent(school, last.to, row.date)) {
        last.to = row.date
        last.days += 1
        continue
      }
      if (last && last.to === row.date && last.from === row.date) {
        // Two holidays on one date: keep both names on the same day.
        last.name = `${last.name} · ${row.name}`
        continue
      }
      ranges.push({ from: row.date, to: row.date, name: row.name, days: 1 })
    }
    return ranges.slice(0, 20)
  }

  protected adjacent(school: School, from: IsoDate, to: IsoDate): boolean {
    for (let date = addDays(from, 1); date < to; date = addDays(date, 1)) {
      if (school.schoolDays.includes(isoWeekday(date))) return false
    }
    return to > from
  }
}
