import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type School from '#models/school'
import WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import HolidayCalendar from '#services/holiday_calendar'
import ProductionReportService from '#services/production_report_service'
import SchoolSettingsService from '#services/school_settings_service'
import { evaluate } from '#services/order_window_service'
import { reportDayValidator } from '#validators/reports'
import { reportDate } from '#support/report_period'
import { reportSchool } from '#support/report_access'
import { presentProduction } from '#support/report_presenters'
import { addDays, isSchoolDay, weekStart, type IsoDate } from '#support/dates'
import { schoolZone } from '#support/menu_display'

/**
 * Kitchen area home = the daily production sheet (brief §5.8): quantity
 * per meal with a breakdown by grade / class, for `?date=` (default today).
 * Read-only for every role (admin, manager, kitchen).
 */
@inject()
export default class DashboardController {
  constructor(
    protected clock: Clock,
    protected reports: ProductionReportService,
    protected holidays: HolidayCalendar,
    protected settings: SchoolSettingsService
  ) {}

  /**
   * Facts about the day shown above the sheet. "Final" comes from the
   * ordering rules themselves (OrderWindowService.evaluate for an active
   * child): once no parent can change the day, the figures are final.
   */
  protected async dayInfo(school: School, date: IsoDate) {
    const holidays = await this.holidays.holidaysBetween(school.id, date, date)
    const holidayNames = holidays.map((row) => row.name)
    const schoolDay = isSchoolDay(date, {
      schoolDays: school.schoolDays,
      schoolYearStart: school.schoolYearStart,
      schoolYearEnd: school.schoolYearEnd,
    })
    const menuDays = await this.reports.menuDays(school.id, [date])
    const hasMenu = menuDays.has(date)
    const menu = await WeeklyMenu.query()
      .where('school_id', school.id)
      .where('week_start', weekStart(date))
      .first()
    const decision = evaluate({
      date,
      now: this.clock.now(),
      zone: schoolZone(school),
      menu: menu ? { status: menu.status, orderDeadlineAt: menu.orderDeadlineAt } : null,
      hasMeals: hasMenu,
      isHoliday: holidayNames.length > 0,
      isSchoolDay: schoolDay,
      settings: this.settings.get(school),
      child: { isActive: true },
      parent: { isActive: true },
    })
    return {
      isSchoolDay: schoolDay,
      holidayNames,
      hasMenu,
      final: !decision.allowed,
      editableUntil: decision.allowed ? (decision.editableUntil?.toISO() ?? null) : null,
    }
  }

  async show(ctx: HttpContext) {
    const { request, inertia, i18n } = ctx
    const school = await reportSchool(ctx)
    const today = this.clock.today()
    let query: { date?: string } = {}
    try {
      query = await reportDayValidator.validate(request.qs())
    } catch {
      query = {}
    }
    const date = reportDate(query.date, today)
    const nav = { date, today, previous: addDays(date, -1), next: addDays(date, 1) }
    if (!school) return inertia.render('kitchen/dashboard', { ...nav, sheet: null, day: null })

    const sheet = await this.reports.production(school.id, date)
    return inertia.render('kitchen/dashboard', {
      ...nav,
      sheet: presentProduction(sheet, i18n.locale),
      day: await this.dayInfo(school, date),
    })
  }
}
