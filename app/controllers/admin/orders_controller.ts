import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Child from '#models/child'
import School from '#models/school'
import SchoolSettingsService from '#services/school_settings_service'
import Clock from '#services/clock'
import OrderService from '#services/order_service'
import OrderWeekService from '#services/order_week_service'
import { staffSchoolId } from '#policies/parent_policy'
import {
  adminOrderListValidator,
  orderWeekQueryValidator,
  staffCancelValidator,
  staffDaySelectionValidator,
} from '#validators/orders'
import { addDays, isIsoDate, weekStart as mondayOf, type IsoDate } from '#support/dates'
import { formatMad } from '#support/money'
import { isBilledType, mealName } from '#support/meal_display'
import { weekBounds } from '#support/menu_display'

const PER_PAGE = 50

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/**
 * Back-office orders (admin + manager of the school): the list of a day's
 * orders with filters, and a child's week where staff can change or cancel
 * any day — an audited override with a mandatory reason (OrderService),
 * the parent is notified. Children are looked up within the staff's school
 * (`Child.visibleTo`), so another school's child is a 404.
 */
@inject()
export default class OrdersController {
  constructor(
    protected settings: SchoolSettingsService,
    protected clock: Clock,
    protected orders: OrderService,
    protected weeks: OrderWeekService
  ) {}

  protected async school(ctx: HttpContext) {
    await ctx.bouncer.with('OrderPolicy').authorize('viewAny')
    return School.findOrFail(staffSchoolId(ctx.auth.getUserOrFail()))
  }

  protected async child(ctx: HttpContext) {
    const childId = Number(ctx.params.childId)
    const child = await Child.query()
      .withScopes((scopes) => scopes.visibleTo(ctx.auth.getUserOrFail()))
      .where('children.id', Number.isSafeInteger(childId) ? childId : 0)
      .firstOrFail()
    await ctx.bouncer.with('OrderPolicy').authorize('manage', child)
    return child
  }

  protected date(ctx: HttpContext): IsoDate {
    const date = String(ctx.params.date)
    if (!isIsoDate(date)) ctx.response.abort('Not found', 404)
    return date
  }

  /** GET /admin/orders — orders of one day, with filters. */
  async index(ctx: HttpContext) {
    const { request, inertia, i18n } = ctx
    const school = await this.school(ctx)
    const allergensEnabled = this.settings.features(school).allergens // D33
    let filters: {
      date?: string
      status?: 'all' | 'active' | 'cancelled'
      q?: string
      className?: string
      page?: number
    } = {}
    try {
      filters = await adminOrderListValidator.validate(request.qs())
    } catch {
      filters = {}
    }
    const date = filters.date ?? this.clock.today()
    const status = filters.status ?? 'all'
    const locale = i18n.locale === 'en' ? 'en' : 'fr'

    const base = db
      .from('meal_orders as mo')
      .join('children as c', 'c.id', 'mo.child_id')
      .join('users as u', 'u.id', 'c.parent_id')
      .where('mo.school_id', school.id)
      .where('mo.date', date)
    if (status !== 'all') base.where('mo.status', status)
    if (filters.className) base.where('c.class_name', filters.className)
    if (filters.q) {
      const pattern = likePattern(filters.q)
      base.where((query) =>
        query
          .whereILike('c.first_name', pattern)
          .orWhereILike('c.last_name', pattern)
          .orWhereILike('u.full_name', pattern)
      )
    }

    const counts = await base
      .clone()
      .select(
        db.raw('count(*)::int AS total'),
        db.raw("count(*) FILTER (WHERE mo.status = 'active')::int AS active"),
        db.raw("count(*) FILTER (WHERE mo.status = 'cancelled')::int AS cancelled")
      )
      .first()
    const total = Number(counts?.total ?? 0)
    const lastPage = Math.max(1, Math.ceil(total / PER_PAGE))
    const page = Math.min(Math.max(1, filters.page ?? 1), lastPage)
    const rows = await base
      .clone()
      .orderBy('c.grade')
      .orderBy('c.class_name')
      .orderBy('c.last_name')
      .orderBy('c.first_name')
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE)
      .select(
        'mo.id',
        'mo.status',
        'mo.cancel_reason',
        'mo.origin',
        'c.id as child_id',
        'c.first_name',
        'c.last_name',
        'c.grade',
        'c.class_name',
        'c.allergies',
        'u.full_name as parent_name'
      )
    const ids = rows.map((row) => Number(row.id))
    const lines = ids.length
      ? await db
          .from('meal_order_items as moi')
          .join('meals as m', 'm.id', 'moi.meal_id')
          .whereIn('moi.meal_order_id', ids)
          .orderBy('moi.meal_type', 'asc')
          .orderBy('moi.id')
          .select(
            'moi.meal_order_id',
            'moi.meal_type',
            'moi.quantity',
            'moi.line_total_cents',
            'm.name_fr',
            'm.name_en'
          )
      : []
    const classes = await db
      .from('children')
      .where('school_id', school.id)
      .whereNotNull('class_name')
      .distinct('class_name')
      .orderBy('class_name')

    return inertia.render('admin/orders/index', {
      filters: { date, status, q: filters.q ?? '', className: filters.className ?? '' },
      classes: classes.map((row) => String(row.class_name)),
      counts: {
        total,
        active: Number(counts?.active ?? 0),
        cancelled: Number(counts?.cancelled ?? 0),
      },
      orders: rows.map((row) => {
        const own = lines.filter((line) => Number(line.meal_order_id) === Number(row.id))
        const totalCents =
          row.status === 'active'
            ? own
                .filter((line) => isBilledType(line.meal_type))
                .reduce((sum, line) => sum + Number(line.line_total_cents), 0)
            : 0
        return {
          id: Number(row.id),
          childId: Number(row.child_id),
          childName: `${row.first_name} ${row.last_name}`,
          grade: row.grade,
          className: row.class_name,
          hasAllergies: allergensEnabled && (row.allergies ?? []).length > 0,
          parentName: row.parent_name,
          status: row.status,
          cancelReason: row.cancel_reason,
          origin: row.origin,
          lines: own.map((line) => ({
            name: mealName({ nameFr: line.name_fr, nameEn: line.name_en }, locale),
            type: line.meal_type,
            quantity: Number(line.quantity),
          })),
          total: formatMad(totalCents, locale),
        }
      }),
      meta: { total, perPage: PER_PAGE, currentPage: page, lastPage },
      weekOf: mondayOf(date),
    })
  }

  /** GET /admin/orders/children/:childId — a child's week (view + audited edits). */
  async childWeek(ctx: HttpContext) {
    const { request, inertia, i18n } = ctx
    await this.school(ctx)
    const child = await this.child(ctx)
    let query: { week?: string } = {}
    try {
      query = await orderWeekQueryValidator.validate(request.qs())
    } catch {
      query = {}
    }
    const week = mondayOf(query.week ?? this.clock.today())
    const view = await this.weeks.week(child, week, i18n.locale)
    const audit = await this.weeks.auditTrail(child.id, week)
    await child.load('parent')
    return inertia.render('admin/orders/child', {
      child: {
        id: child.id,
        firstName: child.firstName,
        lastName: child.lastName,
        grade: child.grade,
        className: child.className,
        isActive: child.isActive,
        parentId: child.parentId,
        parentName: child.parent.fullName,
      },
      week: {
        start: week,
        ...weekBounds(week, view.school.schoolDays),
        previous: addDays(week, -7),
        next: addDays(week, 7),
      },
      view: {
        menu: view.menu,
        rules: view.rules,
        allergies: view.allergies,
        days: view.days,
        total: view.total,
      },
      audit: audit.map((row) => ({
        id: row.id,
        date: row.date,
        action: row.action,
        actorRole: row.actorRole,
        actorName: row.actor?.fullName ?? null,
        reason: row.reason,
        createdAt: row.createdAt.toISO()!,
        before: row.before,
        after: row.after,
      })),
    })
  }

  /** POST /admin/orders/children/:childId/days/:date — staff change (reason required). */
  async saveDay(ctx: HttpContext) {
    const { request, response, auth, session, i18n } = ctx
    await this.school(ctx)
    const child = await this.child(ctx)
    const date = this.date(ctx)
    const input = await request.validateUsing(staffDaySelectionValidator)
    await this.orders.saveDay(
      child.id,
      date,
      {
        subscriptionMealId: input.subscriptionMealId ?? null,
        supplements: input.supplements ?? [],
        confirmAllergy: input.confirmAllergy ?? false,
      },
      { user: auth.getUserOrFail(), ip: request.ip() },
      { reason: input.reason }
    )
    session.flash('success', i18n.t('orders.flash.staff_saved'))
    return response.redirect().back()
  }

  /** POST /admin/orders/children/:childId/days/:date/cancel — staff cancellation. */
  async cancelDay(ctx: HttpContext) {
    const { request, response, auth, session, i18n } = ctx
    await this.school(ctx)
    const child = await this.child(ctx)
    const date = this.date(ctx)
    const input = await request.validateUsing(staffCancelValidator)
    await this.orders.cancelDay(
      child.id,
      date,
      { user: auth.getUserOrFail(), ip: request.ip() },
      { reason: input.reason }
    )
    session.flash('success', i18n.t('orders.flash.staff_cancelled'))
    return response.redirect().back()
  }
}
