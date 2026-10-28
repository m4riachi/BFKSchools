import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import School from '#models/school'
import Meal from '#models/meal'
import MenuItem from '#models/menu_item'
import MenuTemplate from '#models/menu_template'
import WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import MenuBuilderService, { type CopyReport } from '#services/menu_builder_service'
import MenuCalendar, { isMonday } from '#services/menu_calendar'
import MenuPublicationService from '#services/menu_publication_service'
import MenuStatusService, { canTransition } from '#services/menu_status_service'
import MenuChangeService from '#services/menu_change_service'
import SchoolSettingsService from '#services/school_settings_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { staffSchoolId } from '#policies/parent_policy'
import {
  menuItemCreateValidator,
  menuItemUpdateValidator,
  menuTemplateApplyValidator,
  menuTemplateSaveValidator,
  menuTimesValidator,
  menuWeekQueryValidator,
} from '#validators/menus'
import { menuItemRemovalValidator } from '#validators/orders'
import { addDays, isIsoDate, weekStart as mondayOf, type IsoDate } from '#support/dates'
import { allergenLabels, mealName, presentMealSummary } from '#support/meal_display'
import db from '@adonisjs/lucid/services/db'
import { schoolZone, weekBounds } from '#support/menu_display'

/** Weeks shown on the index page around the current one. */
const WEEKS_BEFORE = 4
const WEEKS_AFTER = 8

function toInput(value: DateTime | null | undefined, zone: string) {
  return value ? value.setZone(zone).toFormat("yyyy-LL-dd'T'HH:mm") : ''
}

function fromInput(value: string, zone: string, field: string) {
  const parsed = DateTime.fromISO(value, { zone })
  if (!parsed.isValid) throw new BusinessRuleException('menus.errors.invalid_datetime', { field })
  return parsed
}

/** Flash payload of copy/apply/save so the builder can show what was skipped. */
type MenuReportFlash = {
  kind: 'copy' | 'template_applied' | 'template_saved'
} & Partial<CopyReport>

/**
 * Back-office weekly menus (admin + manager of the school): week list,
 * builder (items, defaults, max quantities, copy, templates), publication
 * times and the status workflow. Menus are addressed by their Monday
 * (`/admin/menus/2026-11-23`) and always looked up within the user's school,
 * so another school's week is never reachable.
 */
@inject()
export default class WeeklyMenusController {
  constructor(
    protected clock: Clock,
    protected builder: MenuBuilderService,
    protected calendar: MenuCalendar,
    protected status: MenuStatusService,
    protected publication: MenuPublicationService,
    protected settings: SchoolSettingsService,
    protected changes: MenuChangeService
  ) {}

  protected async school(ctx: HttpContext) {
    await ctx.bouncer.with('MenuPolicy').authorize('manage')
    return School.findOrFail(staffSchoolId(ctx.auth.getUserOrFail()))
  }

  /** The `:week` param as a Monday, or a 404. */
  protected week(ctx: HttpContext): IsoDate {
    const week = String(ctx.params.week)
    if (!isMonday(week)) ctx.response.abort('Not found', 404)
    return week
  }

  /** The week's menu (must exist) after the policy check. */
  protected async menu(ctx: HttpContext, school: School) {
    const menu = await WeeklyMenu.query()
      .where('school_id', school.id)
      .where('week_start', this.week(ctx))
      .firstOrFail()
    await ctx.bouncer.with('MenuPolicy').authorize('edit', menu)
    return menu
  }

  protected backToWeek(ctx: HttpContext, week: IsoDate) {
    return ctx.response.redirect(`/admin/menus/${week}`)
  }

  async index(ctx: HttpContext) {
    const { request, response, inertia } = ctx
    const school = await this.school(ctx)
    let query: { week?: string } = {}
    try {
      query = await menuWeekQueryValidator.validate(request.qs())
    } catch {
      query = {}
    }
    if (query.week && isMonday(mondayOf(query.week))) {
      return response.redirect(`/admin/menus/${mondayOf(query.week)}`)
    }

    const today = this.clock.today()
    const current = mondayOf(today)
    const from = addDays(current, -7 * WEEKS_BEFORE)
    const to = addDays(current, 7 * WEEKS_AFTER)
    const menus = await WeeklyMenu.query()
      .where('school_id', school.id)
      .whereBetween('week_start', [from, to])
      .withCount('items', (items) => items.whereNull('removed_at'))
    const byWeek = new Map(menus.map((menu) => [menu.weekStart, menu]))
    const zone = schoolZone(school)

    const weeks = []
    for (let week = to; week >= from; week = addDays(week, -7)) {
      const menu = byWeek.get(week)
      const bounds = weekBounds(week, school.schoolDays)
      weeks.push({
        weekStart: week,
        firstDay: bounds.first,
        lastDay: bounds.last,
        isCurrent: week === current,
        isNext: week === addDays(current, 7),
        status: menu?.status ?? null,
        publishAt: menu?.publishAt?.setZone(zone).toISO() ?? null,
        orderDeadlineAt: menu?.orderDeadlineAt?.setZone(zone).toISO() ?? null,
        itemsCount: Number(menu?.$extras.items_count ?? 0),
      })
    }

    return inertia.render('admin/menus/index', {
      today,
      currentWeek: current,
      weeks,
    })
  }

  async show(ctx: HttpContext) {
    const { params, response, inertia, i18n, session, bouncer } = ctx
    const school = await this.school(ctx)
    const raw = String(params.week)
    if (!isMonday(raw)) {
      if (isIsoDate(raw) && isMonday(mondayOf(raw))) {
        return response.redirect(`/admin/menus/${mondayOf(raw)}`)
      }
      return response.notFound()
    }
    const week = raw
    const zone = schoolZone(school)
    const settings = this.settings.get(school)
    const menu = await this.builder.findWeek(school.id, week)
    if (menu) await bouncer.with('MenuPolicy').authorize('edit', menu)

    const days = await this.calendar.days(school, week)
    const items = menu
      ? await MenuItem.query()
          .withScopes((scopes) => scopes.current())
          .where('weekly_menu_id', menu.id)
          .preload('meal', (meal) =>
            meal.preload('photos', (photos) => photos.where('is_cover', true))
          )
          .orderBy('date')
          .orderBy('position')
          .orderBy('id')
      : []
    const issues = menu ? this.calendar.readiness(school, menu, days, items) : []
    const defaults = this.calendar.defaultTimes(school, week)

    const catalog = await Meal.query()
      .withScopes((scopes) => scopes.offerable())
      .preload('photos', (photos) => photos.where('is_cover', true))
      .orderByRaw(i18n.locale === 'en' ? 'lower(name_en)' : 'lower(name_fr)')
      .orderBy('id')

    // Portions ordered per item (active orders): shown on published menus,
    // removal of an ordered item goes through the impact page.
    const ordered = new Map<number, number>()
    if (items.length && menu && menu.status !== 'draft') {
      const rows = await db
        .from('meal_order_items as moi')
        .join('meal_orders as mo', 'mo.id', 'moi.meal_order_id')
        .whereIn(
          'moi.menu_item_id',
          items.map((item) => item.id)
        )
        .where('mo.status', 'active')
        .groupBy('moi.menu_item_id')
        .select('moi.menu_item_id', db.raw('sum(moi.quantity)::int AS total'))
      for (const row of rows) ordered.set(Number(row.menu_item_id), Number(row.total))
    }

    const presentItem = (item: MenuItem) => ({
      id: item.id,
      date: item.date,
      type: item.mealType,
      isDefault: item.isDefault,
      maxQuantity: item.maxQuantity,
      ordered: ordered.get(item.id) ?? 0,
      meal: {
        ...presentMealSummary(item.meal, i18n.locale),
        isDeleted: item.meal.isDeleted,
      },
    })

    // Days outside the school-day columns can still hold items (e.g. the
    // school days changed); show them so they can be removed.
    const columns = [...days]
    for (const item of items) {
      if (!columns.some((day) => day.date === item.date)) {
        columns.push({ date: item.date, weekday: 0, state: 'not_school_day', holidayNames: [] })
      }
    }
    columns.sort((a, b) => a.date.localeCompare(b.date))

    const status = menu?.status ?? 'draft'
    const templates = await MenuTemplate.query()
      .where('school_id', school.id)
      .withCount('items')
      .orderByRaw('lower(name)')
    const previous = await this.builder.findWeek(school.id, addDays(week, -7))
    const previousCount = previous
      ? await MenuItem.query()
          .withScopes((scopes) => scopes.current())
          .where('weekly_menu_id', previous.id)
          .count('* as total')
      : []

    return inertia.render('admin/menus/show', {
      week: {
        start: week,
        ...weekBounds(week, school.schoolDays),
        previous: addDays(week, -7),
        next: addDays(week, 7),
      },
      menu: menu
        ? {
            id: menu.id,
            status: menu.status,
            publishAt: menu.publishAt?.setZone(zone).toISO() ?? null,
            orderDeadlineAt: menu.orderDeadlineAt?.setZone(zone).toISO() ?? null,
            publishedAt: menu.publishedAt?.setZone(zone).toISO() ?? null,
            closedAt: menu.closedAt?.setZone(zone).toISO() ?? null,
            notes: menu.notes,
          }
        : null,
      times: {
        publishAt: toInput(
          menu ? menu.publishAt : defaults.valid ? defaults.publishAt : null,
          zone
        ),
        orderDeadlineAt: toInput(
          menu ? menu.orderDeadlineAt : defaults.valid ? defaults.orderDeadlineAt : null,
          zone
        ),
        fromSettings: !menu,
      },
      days: columns.map((day) => ({
        ...day,
        items: items.filter((item) => item.date === day.date).map(presentItem),
      })),
      catalog: catalog.map((meal) => presentMealSummary(meal, i18n.locale)),
      issues,
      templates: templates.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        itemsCount: Number(template.$extras.items_count ?? 0),
      })),
      hasPreviousWeek: Number(previousCount[0]?.$extras.total ?? 0) > 0,
      recipients: await this.publication.countRecipients(school.id),
      editRule: {
        allowParentEdits: settings.allow_parent_edits,
        editMode: settings.edit_mode,
        cutoffDaysBefore: settings.edit_cutoff_days_before,
        cutoffTime: settings.edit_cutoff_time,
      },
      emailsEnabled:
        settings.email_notifications.enabled && settings.email_notifications.menu_published,
      can: {
        addItems: status !== 'closed',
        removeItems: status !== 'closed',
        // D18: a published day's default can change until the order deadline.
        setDefault:
          status !== 'closed' &&
          (status !== 'published' ||
            (menu?.orderDeadlineAt !== null &&
              menu?.orderDeadlineAt !== undefined &&
              menu.orderDeadlineAt > this.clock.now())),
        editItems: status !== 'closed',
        editTimes: status === 'draft' || status === 'scheduled',
        replaceItems: status === 'draft',
        schedule: canTransition(status, 'scheduled'),
        unschedule: canTransition(status, 'draft'),
        publish: menu !== null && canTransition(status, 'published'),
      },
      report: (session.flashMessages.get('menuReport') as MenuReportFlash | undefined) ?? null,
    })
  }

  /* Items ------------------------------------------------------------- */

  async storeItem(ctx: HttpContext) {
    const { request, auth, session, i18n } = ctx
    const school = await this.school(ctx)
    const week = this.week(ctx)
    const input = await request.validateUsing(menuItemCreateValidator)
    const item = await this.builder.addItem(school, week, input, auth.getUserOrFail())
    const meal = await Meal.findOrFail(item.mealId)
    session.flash(
      'success',
      i18n.t('menus.flash.item_added', { name: mealName(meal, i18n.locale) })
    )
    return this.backToWeek(ctx, week)
  }

  async updateItem(ctx: HttpContext) {
    const { request, auth, params, session, i18n } = ctx
    const school = await this.school(ctx)
    const menu = await this.menu(ctx, school)
    const input = await request.validateUsing(menuItemUpdateValidator)
    await this.builder.updateItem(school, menu, Number(params.id), input, auth.getUserOrFail())
    session.flash('success', i18n.t('menus.flash.item_updated'))
    return this.backToWeek(ctx, menu.weekStart)
  }

  async setDefault(ctx: HttpContext) {
    const { auth, params, session, i18n } = ctx
    const school = await this.school(ctx)
    const menu = await this.menu(ctx, school)
    await this.builder.setDefault(school, menu, Number(params.id), auth.getUserOrFail())
    session.flash('success', i18n.t('menus.flash.default_set'))
    return this.backToWeek(ctx, menu.weekStart)
  }

  /**
   * Removes an item. On a published menu, an item with orders needs a
   * resolution (`mode` switch + `targetItemId`, or cancel) chosen on the
   * impact page; without one the request is refused with the count.
   */
  async destroyItem(ctx: HttpContext) {
    const { auth, params, session, i18n, request } = ctx
    const school = await this.school(ctx)
    const menu = await this.menu(ctx, school)
    const input = await request.validateUsing(menuItemRemovalValidator)
    const resolution =
      input.mode === 'switch'
        ? input.targetItemId
          ? { mode: 'switch' as const, targetItemId: input.targetItemId }
          : null
        : input.mode === 'cancel'
          ? { mode: 'cancel' as const }
          : null
    if (input.mode === 'switch' && !input.targetItemId) {
      throw new BusinessRuleException('menus.errors.switch_target', { field: 'targetItemId' })
    }
    const result = await this.builder.removeItem(
      school,
      menu,
      Number(params.id),
      auth.getUserOrFail(),
      resolution
    )
    session.flash(
      'success',
      result.outcome && result.outcome.orders > 0
        ? i18n.t('menus.flash.item_removed_with_orders', {
            orders: result.outcome.orders,
            switched: result.outcome.switched,
            cancelled: result.outcome.cancelledOrders,
          })
        : i18n.t('menus.flash.item_removed')
    )
    return this.backToWeek(ctx, menu.weekStart)
  }

  /**
   * GET items/:id/remove — impact page of removing an item from a
   * published menu: the affected orders and the meals they can switch to.
   */
  async removeItemImpact(ctx: HttpContext) {
    const { params, inertia, i18n } = ctx
    const school = await this.school(ctx)
    const menu = await this.menu(ctx, school)
    const item = await MenuItem.query()
      .withScopes((scopes) => scopes.current())
      .where('weekly_menu_id', menu.id)
      .where('id', Number(params.id))
      .preload('meal')
      .firstOrFail()
    const affected = await this.changes.affectedOrders(db.connection(), item.id)
    const alternatives = await this.changes.alternatives(db.connection(), item)
    const locale = i18n.locale
    return inertia.render('admin/menus/remove_item', {
      week: menu.weekStart,
      menuStatus: menu.status,
      isPast: item.date < this.clock.today(),
      item: {
        id: item.id,
        date: item.date,
        type: item.mealType,
        isDefault: item.isDefault,
        meal: presentMealSummary(item.meal, locale),
      },
      affected: affected.map((order) => ({
        ...order,
        allergies: allergenLabels(order.allergies as never, locale),
      })),
      alternatives: alternatives.map((option) => ({
        id: option.id,
        name: mealName(option.meal, locale),
        price: presentMealSummary(option.meal, locale).price,
        allergens: [...option.meal.allergens],
        maxQuantity: option.maxQuantity,
        // Children of the list who are allergic to this alternative lose the line instead.
        allergicChildren: affected.filter((order) =>
          option.meal.allergens.some((code) => order.allergies.includes(code))
        ).length,
      })),
    })
  }

  /* Copy / templates ---------------------------------------------------- */

  async copyPrevious(ctx: HttpContext) {
    const { auth, session, i18n } = ctx
    const school = await this.school(ctx)
    const week = this.week(ctx)
    const report = await this.builder.copyPreviousWeek(school, week, auth.getUserOrFail())
    session.flash('menuReport', { kind: 'copy', ...report } satisfies MenuReportFlash)
    session.flash('success', i18n.t('menus.flash.copied', { count: report.added }))
    return this.backToWeek(ctx, week)
  }

  async applyTemplate(ctx: HttpContext) {
    const { request, auth, session, i18n, bouncer } = ctx
    const school = await this.school(ctx)
    const week = this.week(ctx)
    const { templateId } = await request.validateUsing(menuTemplateApplyValidator)
    const template = await MenuTemplate.query()
      .where('school_id', school.id)
      .where('id', templateId)
      .firstOrFail()
    await bouncer.with('MenuPolicy').authorize('editTemplate', template)
    const report = await this.builder.applyTemplate(school, week, template, auth.getUserOrFail())
    session.flash('menuReport', { kind: 'template_applied', ...report } satisfies MenuReportFlash)
    session.flash(
      'success',
      i18n.t('menus.flash.template_applied', { name: template.name, count: report.added })
    )
    return this.backToWeek(ctx, week)
  }

  async saveTemplate(ctx: HttpContext) {
    const { request, auth, session, i18n } = ctx
    const school = await this.school(ctx)
    const menu = await this.menu(ctx, school)
    const input = await request.validateUsing(menuTemplateSaveValidator)
    const result = await this.builder.saveAsTemplate(school, menu, input, auth.getUserOrFail())
    session.flash('menuReport', {
      kind: 'template_saved',
      added: result.added,
      skippedMeals: result.skippedMeals,
    } satisfies MenuReportFlash)
    session.flash('success', i18n.t('menus.flash.template_saved', { name: result.template.name }))
    return this.backToWeek(ctx, menu.weekStart)
  }

  async destroyTemplate(ctx: HttpContext) {
    const { params, request, response, session, i18n, bouncer } = ctx
    const school = await this.school(ctx)
    const template = await MenuTemplate.query()
      .where('school_id', school.id)
      .where('id', Number(params.id))
      .firstOrFail()
    await bouncer.with('MenuPolicy').authorize('editTemplate', template)
    await this.builder.deleteTemplate(template)
    session.flash('success', i18n.t('menus.flash.template_deleted', { name: template.name }))
    const week = request.input('week')
    return isMonday(week)
      ? response.redirect(`/admin/menus/${week}`)
      : response.redirect('/admin/menus')
  }

  /* Times and status ----------------------------------------------------- */

  async updateTimes(ctx: HttpContext) {
    const { request, auth, session, i18n } = ctx
    const school = await this.school(ctx)
    const week = this.week(ctx)
    const input = await request.validateUsing(menuTimesValidator)
    const zone = schoolZone(school)
    const times = {
      publishAt: fromInput(input.publishAt, zone, 'publishAt'),
      orderDeadlineAt: fromInput(input.orderDeadlineAt, zone, 'orderDeadlineAt'),
      notes: input.notes,
    }
    const actor = auth.getUserOrFail()
    // Validate first, then create the draft (if needed) and save the times
    // in one transaction: a refused input never leaves an empty draft behind.
    this.status.validateTimes(school, week, times)
    const existing = await this.builder.findWeek(school.id, week)
    if (existing) await ctx.bouncer.with('MenuPolicy').authorize('edit', existing)
    await this.builder.withMenu(school, week, actor, async (_trx, menu) => {
      await ctx.bouncer.with('MenuPolicy').authorize('edit', menu)
      await this.status.applyTimes(school, menu, times, actor)
    })
    session.flash('success', i18n.t('menus.flash.times_saved'))
    return this.backToWeek(ctx, week)
  }

  async schedule(ctx: HttpContext) {
    const { auth, session, i18n } = ctx
    const school = await this.school(ctx)
    const menu = await this.menu(ctx, school)
    await this.status.schedule(school, menu, auth.getUserOrFail())
    session.flash('success', i18n.t('menus.flash.scheduled'))
    return this.backToWeek(ctx, menu.weekStart)
  }

  async unschedule(ctx: HttpContext) {
    const { auth, session, i18n } = ctx
    const school = await this.school(ctx)
    const menu = await this.menu(ctx, school)
    await this.status.unschedule(menu, auth.getUserOrFail())
    session.flash('success', i18n.t('menus.flash.unscheduled'))
    return this.backToWeek(ctx, menu.weekStart)
  }

  async publish(ctx: HttpContext) {
    const { auth, session, i18n } = ctx
    const school = await this.school(ctx)
    const menu = await this.menu(ctx, school)
    const outcome = await this.status.publishNow(menu, auth.getUserOrFail())
    session.flash(
      'success',
      i18n.t('menus.flash.published', {
        recipients: outcome.published ? outcome.recipients : 0,
      })
    )
    return this.backToWeek(ctx, menu.weekStart)
  }
}
