import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import School from '#models/school'
import type Holiday from '#models/holiday'
import Clock from '#services/clock'
import HolidayService from '#services/holiday_service'
import HolidayGeneratorService from '#services/holiday_generator_service'
import SchoolSettingsService from '#services/school_settings_service'
import { staffSchoolId } from '#policies/parent_policy'
import { HOLIDAY_PERIOD_FILTERS, HOLIDAY_SOURCES, HOLIDAY_STATUS_FILTERS } from '#enums/holidays'
import {
  holidayCreateValidator,
  holidayGenerateValidator,
  holidayGroupUpdateValidator,
  holidayListValidator,
  holidaySettingsValidator,
  holidayToggleValidator,
  holidayUpdateValidator,
} from '#validators/holidays'
import { addDays } from '#support/dates'

function presentRow(holiday: Holiday) {
  return {
    id: holiday.id,
    date: holiday.date,
    name: holiday.name,
    source: holiday.source,
    isActive: holiday.isActive,
    groupId: holiday.groupId,
    generated: holiday.ruleKey !== null,
  }
}

/** "2026–2027" from the school year dates. */
export function schoolYearLabel(school: School) {
  return `${school.schoolYearStart.slice(0, 4)}–${school.schoolYearEnd.slice(0, 4)}`
}

/**
 * Back-office holidays (admin + manager of the school): month calendar and
 * list views, manual days and ranges, enable/disable, rename, delete, the
 * "Generate holidays for school year YYYY–YYYY" action and the Moroccan
 * generator switch (admin only). Rows of another school are a 404.
 */
@inject()
export default class HolidaysController {
  constructor(
    protected holidays: HolidayService,
    protected generator: HolidayGeneratorService,
    protected settings: SchoolSettingsService,
    protected clock: Clock
  ) {}

  protected async school(ctx: HttpContext) {
    await ctx.bouncer.with('HolidayPolicy').authorize('manage')
    return School.findOrFail(staffSchoolId(ctx.auth.getUserOrFail()))
  }

  async index(ctx: HttpContext) {
    const { request, inertia, bouncer } = ctx
    const school = await this.school(ctx)
    let query: Awaited<ReturnType<typeof holidayListValidator.validate>> = {}
    try {
      query = await holidayListValidator.validate(request.qs())
    } catch {
      query = {}
    }

    const today = this.clock.today()
    const view = query.view ?? 'calendar'
    const defaultMonth =
      today >= school.schoolYearStart && today <= school.schoolYearEnd
        ? today.slice(0, 7)
        : school.schoolYearStart.slice(0, 7)
    const month = query.month ?? defaultMonth
    const monthStart = `${month}-01`
    const monthEnd = addDays(`${addDays(monthStart, 32).slice(0, 7)}-01`, -1)

    const filters = {
      q: query.q ?? '',
      source: query.source ?? '',
      status: query.status ?? 'all',
      period: query.period ?? 'school_year',
      page: query.page ?? 1,
    }

    let calendar = null
    if (view === 'calendar') {
      const rows = await this.holidays.monthRows(school.id, monthStart, monthEnd)
      const groupIds = rows.map((row) => row.groupId).filter((id): id is string => id !== null)
      calendar = {
        month,
        rows: rows.map(presentRow),
        groups: await this.holidays.groupSummaries(school.id, groupIds),
      }
    }
    const list =
      view === 'list'
        ? await this.holidays.list(
            school,
            {
              q: query.q,
              source: query.source,
              status: query.status,
              period: query.period,
              page: query.page,
            },
            today
          )
        : null

    return inertia.render('admin/holidays/index', {
      view,
      today,
      school: {
        schoolDays: [...school.schoolDays],
        schoolYearStart: school.schoolYearStart,
        schoolYearEnd: school.schoolYearEnd,
        schoolYearLabel: schoolYearLabel(school),
      },
      calendar,
      list,
      filters,
      options: {
        sources: [...HOLIDAY_SOURCES],
        statuses: [...HOLIDAY_STATUS_FILTERS],
        periods: [...HOLIDAY_PERIOD_FILTERS],
      },
      settings: {
        generateMoroccanHolidays: this.settings.get(school).generate_moroccan_holidays,
        canConfigure: await bouncer.with('SchoolPolicy').allows('updateSettings', school),
      },
    })
  }

  async store(ctx: HttpContext) {
    const { request, response, session, i18n, auth } = ctx
    const school = await this.school(ctx)
    const { confirmImpact, ...input } = await request.validateUsing(holidayCreateValidator)
    const result = await this.holidays.createManual(school, input, {
      confirmImpact,
      actor: auth.getUserOrFail(),
    })
    session.flash('success', i18n.t('holidays.flash.created', { count: result.created }))
    return response.redirect().back()
  }

  async update(ctx: HttpContext) {
    const { params, request, response, session, i18n, auth, bouncer } = ctx
    const school = await this.school(ctx)
    const holiday = await this.holidays.findListed(school.id, params.id)
    await bouncer.with('HolidayPolicy').authorize('edit', holiday)
    const { confirmImpact, ...input } = await request.validateUsing(holidayUpdateValidator)
    await this.holidays.updateOne(school, holiday, input, {
      confirmImpact,
      actor: auth.getUserOrFail(),
    })
    session.flash('success', i18n.t('holidays.flash.updated'))
    return response.redirect().back()
  }

  async updateGroup(ctx: HttpContext) {
    const { params, request, response, session, i18n, auth } = ctx
    const school = await this.school(ctx)
    const { confirmImpact, ...input } = await request.validateUsing(holidayGroupUpdateValidator)
    await this.holidays.updateGroup(school, String(params.groupId), input, {
      confirmImpact,
      actor: auth.getUserOrFail(),
    })
    session.flash('success', i18n.t('holidays.flash.updated'))
    return response.redirect().back()
  }

  async toggle(ctx: HttpContext) {
    const { params, request, response, session, i18n, auth, bouncer } = ctx
    const school = await this.school(ctx)
    const holiday = await this.holidays.findListed(school.id, params.id)
    await bouncer.with('HolidayPolicy').authorize('edit', holiday)
    const { active, confirmImpact } = await request.validateUsing(holidayToggleValidator)
    await this.holidays.setActive(school, [holiday], active, {
      confirmImpact,
      actor: auth.getUserOrFail(),
    })
    session.flash('success', i18n.t(active ? 'holidays.flash.enabled' : 'holidays.flash.disabled'))
    return response.redirect().back()
  }

  async toggleGroup(ctx: HttpContext) {
    const { params, request, response, session, i18n, auth } = ctx
    const school = await this.school(ctx)
    const rows = await this.holidays.findGroup(school.id, String(params.groupId))
    const { active, confirmImpact } = await request.validateUsing(holidayToggleValidator)
    await this.holidays.setActive(school, rows, active, {
      confirmImpact,
      actor: auth.getUserOrFail(),
    })
    session.flash('success', i18n.t(active ? 'holidays.flash.enabled' : 'holidays.flash.disabled'))
    return response.redirect().back()
  }

  async destroy(ctx: HttpContext) {
    const { params, response, session, i18n, bouncer } = ctx
    const school = await this.school(ctx)
    const holiday = await this.holidays.findListed(school.id, params.id)
    await bouncer.with('HolidayPolicy').authorize('edit', holiday)
    await this.holidays.remove([holiday])
    session.flash('success', i18n.t('holidays.flash.deleted', { count: 1 }))
    return response.redirect().back()
  }

  async destroyGroup(ctx: HttpContext) {
    const { params, response, session, i18n } = ctx
    const school = await this.school(ctx)
    const rows = await this.holidays.findGroup(school.id, String(params.groupId))
    await this.holidays.remove(rows)
    session.flash('success', i18n.t('holidays.flash.deleted', { count: rows.length }))
    return response.redirect().back()
  }

  /** "Generate holidays for school year YYYY–YYYY". */
  async generate(ctx: HttpContext) {
    const { request, response, session, i18n, auth } = ctx
    const school = await this.school(ctx)
    const { confirmImpact } = await request.validateUsing(holidayGenerateValidator)
    const result = await this.generator.generate(school, {
      confirmImpact,
      actor: auth.getUserOrFail(),
    })
    session.flash(
      'success',
      i18n.t('holidays.flash.generated', {
        year: schoolYearLabel(school),
        created: result.created,
        skipped: result.skipped,
      })
    )
    return response.redirect().back()
  }

  /** Admin only: the Moroccan fixed-date generator switch (D6, school setting). */
  async updateSettings(ctx: HttpContext) {
    const { request, response, session, i18n, bouncer } = ctx
    const school = await this.school(ctx)
    await bouncer.with('SchoolPolicy').authorize('updateSettings', school)
    const { generateMoroccanHolidays } = await request.validateUsing(holidaySettingsValidator)
    await this.settings.update(school, { generate_moroccan_holidays: generateMoroccanHolidays })
    session.flash(
      'success',
      i18n.t(
        generateMoroccanHolidays ? 'holidays.flash.moroccan_on' : 'holidays.flash.moroccan_off'
      )
    )
    return response.redirect().back()
  }
}
