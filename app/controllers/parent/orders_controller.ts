import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import Child from '#models/child'
import MealOrder from '#models/meal_order'
import Clock from '#services/clock'
import OrderService from '#services/order_service'
import OrderWeekService from '#services/order_week_service'
import {
  applyAllValidator,
  daySelectionValidator,
  orderHistoryQueryValidator,
  orderWeekQueryValidator,
} from '#validators/orders'
import { addDays, isIsoDate, weekStart as mondayOf, type IsoDate } from '#support/dates'
import { formatMad } from '#support/money'
import { mealName } from '#support/meal_display'
import { weekBounds } from '#support/menu_display'
import { homePathFor } from '#enums/roles'
import { safeTranslate } from '#support/safe_translate'
import OrderRuleException from '#exceptions/order_rule_exception'

/** Weeks a parent can open around the current one. */
const WEEKS_BEFORE = 4
const WEEKS_AFTER = 8
const HISTORY_PER_PAGE = 20

/**
 * Parent portal ordering (brief §5.5, mobile-first). Every request:
 * `accessParentPortal` ability → the child is looked up through
 * `Child.visibleTo(user)` (another family's id is a 404, nothing leaks) →
 * `OrderPolicy.order`. Day states, reasons, flags and totals come from the
 * server (OrderWeekService / OrderWindowService); writes go through
 * OrderService, which re-checks every rule under locks.
 */
@inject()
export default class OrdersController {
  constructor(
    protected clock: Clock,
    protected orders: OrderService,
    protected weeks: OrderWeekService
  ) {}

  protected async children(ctx: HttpContext) {
    await ctx.bouncer.authorize('accessParentPortal')
    return Child.query()
      .withScopes((scopes) => scopes.visibleTo(ctx.auth.getUserOrFail()))
      .where('children.is_active', true)
      .orderBy('first_name')
      .orderBy('id')
  }

  /** A child of the logged-in parent, or a 404. */
  protected async child(ctx: HttpContext, id: unknown) {
    await ctx.bouncer.authorize('accessParentPortal')
    const childId = Number(id)
    const query = Child.query().withScopes((scopes) => scopes.visibleTo(ctx.auth.getUserOrFail()))
    const child =
      Number.isSafeInteger(childId) && childId > 0
        ? await query.where('children.id', childId).firstOrFail()
        : await query.whereRaw('false').firstOrFail()
    await ctx.bouncer.with('OrderPolicy').authorize('order', child)
    return child
  }

  protected date(ctx: HttpContext): IsoDate {
    const date = String(ctx.params.date)
    if (!isIsoDate(date)) ctx.response.abort('Not found', 404)
    return date
  }

  /** The week to show: a Monday within the allowed window, else the current week. */
  protected pickWeek(value: string | undefined): IsoDate {
    const current = mondayOf(this.clock.today())
    if (!value) return current
    const week = mondayOf(value)
    if (week < addDays(current, -7 * WEEKS_BEFORE) || week > addDays(current, 7 * WEEKS_AFTER)) {
      return current
    }
    return week
  }

  /** GET / — the week view (child switcher, day cards, totals). */
  async week(ctx: HttpContext) {
    const { auth, response, request, inertia, i18n } = ctx
    const user = auth.getUserOrFail()
    if (user.role !== 'parent') return response.redirect(homePathFor(user.role))

    const children = await this.children(ctx)
    let query: { child?: number; week?: string } = {}
    try {
      query = await orderWeekQueryValidator.validate(request.qs())
    } catch {
      query = {}
    }
    const week = this.pickWeek(query.week)
    const current = mondayOf(this.clock.today())
    // A `child` the parent can't see (another family's, unknown, malformed)
    // is a 404, like every write — never a silent fallback.
    const requested = request.qs().child
    if (requested !== undefined && !children.some((c) => c.id === query.child)) {
      return response.notFound()
    }
    const child = children.find((candidate) => candidate.id === query.child) ?? children[0] ?? null
    if (child) await ctx.bouncer.with('OrderPolicy').authorize('order', child)

    const view = child ? await this.weeks.week(child, week, i18n.locale) : null
    const totals = await this.weeks.weekTotals(
      children.map((candidate) => candidate.id),
      week
    )
    const locale = i18n.locale === 'en' ? 'en' : 'fr'
    const familyCents = [...totals.values()].reduce((sum, cents) => sum + cents, 0)

    return inertia.render('parent/orders/week', {
      today: this.clock.today(),
      week: {
        start: week,
        ...(view
          ? weekBounds(week, view.school.schoolDays)
          : { first: week, last: addDays(week, 4) }),
        current,
        following: addDays(current, 7),
        previous: week > addDays(current, -7 * WEEKS_BEFORE) ? addDays(week, -7) : null,
        next: week < addDays(current, 7 * WEEKS_AFTER) ? addDays(week, 7) : null,
      },
      children: children.map((candidate) => ({
        id: candidate.id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        grade: candidate.grade,
        className: candidate.className,
        totalCents: totals.get(candidate.id) ?? 0,
        total: formatMad(totals.get(candidate.id) ?? 0, locale),
      })),
      childId: child?.id ?? null,
      view: view
        ? {
            menu: view.menu,
            rules: view.rules,
            allergies: view.allergies,
            days: view.days,
            total: view.total,
          }
        : null,
      family: { totalCents: familyCents, total: formatMad(familyCents, locale) },
    })
  }

  /** POST /orders/:childId/days/:date — save one day's selection. */
  async saveDay(ctx: HttpContext) {
    const { params, request, response, auth, session, i18n } = ctx
    const child = await this.child(ctx, params.childId)
    const date = this.date(ctx)
    const input = await request.validateUsing(daySelectionValidator)
    const outcome = await this.orders.saveDay(
      child.id,
      date,
      {
        subscriptionMealId: input.subscriptionMealId ?? null,
        supplements: input.supplements ?? [],
        confirmAllergy: input.confirmAllergy ?? false,
      },
      { user: auth.getUserOrFail(), ip: request.ip() }
    )
    if (outcome.action) session.flash('success', i18n.t('orders.flash.saved'))
    return response.redirect().back()
  }

  /** POST /orders/:childId/days/:date/absent — "no meal this day". */
  async cancelDay(ctx: HttpContext) {
    const { params, request, response, auth, session, i18n } = ctx
    const child = await this.child(ctx, params.childId)
    const date = this.date(ctx)
    const outcome = await this.orders.cancelDay(child.id, date, {
      user: auth.getUserOrFail(),
      ip: request.ip(),
    })
    if (outcome.action) session.flash('success', i18n.t('orders.flash.absent'))
    return response.redirect().back()
  }

  /** POST /orders/days/:date/all — same choice for several of my children. */
  async applyAll(ctx: HttpContext) {
    const { request, response, auth, session, i18n, bouncer } = ctx
    await bouncer.authorize('accessParentPortal')
    const date = this.date(ctx)
    const input = await request.validateUsing(applyAllValidator)
    // Allergies are confirmed child by child, never for a whole family.
    if (input.confirmAllergy) throw new OrderRuleException('APPLY_ALL_NO_CONFIRM')
    const user = auth.getUserOrFail()
    // Every id must be one of the parent's children: otherwise nothing is done (404).
    const mine = await Child.query()
      .withScopes((scopes) => scopes.visibleTo(user))
      .whereIn('children.id', input.childIds)
    if (mine.length !== input.childIds.length) return response.notFound()
    for (const child of mine) await bouncer.with('OrderPolicy').authorize('order', child)

    const results = await this.orders.applyToChildren(
      { user, ip: request.ip() },
      date,
      input.absent
        ? { absent: true }
        : {
            subscriptionMealId: input.subscriptionMealId ?? null,
            supplements: input.supplements ?? [],
            confirmAllergy: false,
          },
      input.childIds
    )
    const names = new Map(mine.map((child) => [child.id, child.firstName]))
    const failed = results.filter((result) => !result.ok)
    const okCount = results.length - failed.length
    if (okCount) session.flash('success', i18n.t('orders.flash.applied', { count: okCount }))
    if (failed.length) {
      session.flash(
        'error',
        failed
          .map((result) =>
            result.ok
              ? ''
              : `${names.get(result.childId) ?? ''}: ${safeTranslate(i18n, result.messageKey, result.values ?? {})}`
          )
          .join(' · ')
      )
    }
    return response.redirect().back()
  }

  /** GET /orders/history — past and upcoming orders of the family. */
  async history(ctx: HttpContext) {
    const { request, inertia, i18n } = ctx
    const children = await this.children(ctx)
    let query: { child?: number; page?: number } = {}
    try {
      query = await orderHistoryQueryValidator.validate(request.qs())
    } catch {
      query = {}
    }
    const selected = children.find((child) => child.id === query.child) ?? null
    const ids = selected ? [selected.id] : children.map((child) => child.id)
    const locale = i18n.locale === 'en' ? 'en' : 'fr'

    const page = await MealOrder.query()
      .whereIn('child_id', ids.length ? ids : [0])
      .preload('child')
      .preload('items', (lines) => lines.preload('meal').orderBy('meal_type', 'asc').orderBy('id'))
      .orderBy('date', 'desc')
      .orderBy('id', 'desc')
      .paginate(query.page ?? 1, HISTORY_PER_PAGE)

    return inertia.render('parent/orders/history', {
      children: children.map((child) => ({ id: child.id, firstName: child.firstName })),
      childId: selected?.id ?? null,
      orders: page.all().map((order) => {
        const totalCents =
          order.status === 'active'
            ? order.items.reduce((sum, line) => sum + (line.lineTotalCents ?? 0), 0)
            : 0
        return {
          id: order.id,
          date: order.date,
          childName: order.child.firstName,
          status: order.status,
          cancelReason: order.cancelReason,
          origin: order.origin,
          lines: order.items.map((line) => ({
            name: mealName(line.meal, locale),
            type: line.mealType,
            quantity: line.quantity,
            unitPrice: formatMad(line.unitPriceCents, locale),
            lineTotal: formatMad(line.lineTotalCents ?? 0, locale),
          })),
          total: formatMad(totalCents, locale),
        }
      }),
      meta: {
        total: page.total,
        currentPage: page.currentPage,
        lastPage: page.lastPage,
        perPage: page.perPage,
      },
    })
  }
}
