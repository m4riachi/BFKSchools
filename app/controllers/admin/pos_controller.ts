import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import Child from '#models/child'
import School from '#models/school'
import Clock from '#services/clock'
import OrderService from '#services/order_service'
import OrderWeekService from '#services/order_week_service'
import PosService from '#services/pos_service'
import { staffSchoolId } from '#policies/parent_policy'
import { posDaySelectionValidator, posQueryValidator } from '#validators/orders'
import { addDays, focusDay, isIsoDate, weekStart as mondayOf, type IsoDate } from '#support/dates'
import { weekBounds } from '#support/menu_display'

/**
 * Ordering desk (D39, admin + manager): pick a family and a child, then order
 * for a parent who does not use the app. Same rules as the child's week page
 * (OrderService); the audit reason is filled in and the order is tagged `staff`.
 */
@inject()
export default class PosController {
  constructor(
    protected clock: Clock,
    protected orders: OrderService,
    protected weeks: OrderWeekService,
    protected pos: PosService
  ) {}

  protected async school(ctx: HttpContext) {
    await ctx.bouncer.with('OrderPolicy').authorize('viewAny')
    return School.findOrFail(staffSchoolId(ctx.auth.getUserOrFail()))
  }

  protected async child(ctx: HttpContext, id: number) {
    const child = await Child.query()
      .withScopes((scopes) => scopes.visibleTo(ctx.auth.getUserOrFail()))
      .where('children.id', id)
      .firstOrFail()
    await ctx.bouncer.with('OrderPolicy').authorize('manage', child)
    return child
  }

  protected date(ctx: HttpContext): IsoDate {
    const date = String(ctx.params.date)
    if (!isIsoDate(date)) ctx.response.abort('Not found', 404)
    return date
  }

  /** GET /admin/pos?q=&child=&week= */
  async show(ctx: HttpContext) {
    const { request, inertia, i18n } = ctx
    const school = await this.school(ctx)
    const [, query] = await posQueryValidator.tryValidate(request.qs())
    const families = await this.pos.searchFamilies(school, query?.q)
    if (!query?.child) {
      return inertia.render('admin/pos/index', { q: query?.q ?? '', families, selected: null })
    }

    const child = await this.child(ctx, query.child)
    await child.load('parent')
    const siblings = await Child.query()
      .where('parent_id', child.parentId)
      .where('is_active', true)
      .orderBy('first_name')
    const week = mondayOf(query.week ?? focusDay(this.clock.today(), school.schoolDays))
    const view = await this.weeks.week(child, week, i18n.locale)
    return inertia.render('admin/pos/index', {
      q: query.q ?? '',
      families,
      selected: {
        child: { id: child.id, firstName: child.firstName, lastName: child.lastName },
        parentName: child.parent.fullName,
        siblings: siblings.map((sibling) => ({ id: sibling.id, firstName: sibling.firstName })),
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
      },
    })
  }

  /** POST /admin/pos/children/:childId/days/:date */
  async saveDay(ctx: HttpContext) {
    const { request, response, auth, session, i18n } = ctx
    await this.school(ctx)
    const child = await this.child(ctx, Number(ctx.params.childId))
    const input = await request.validateUsing(posDaySelectionValidator)
    await this.orders.saveDay(
      child.id,
      this.date(ctx),
      {
        subscriptionMealId: input.subscriptionMealId ?? null,
        supplements: input.supplements ?? [],
        confirmAllergy: input.confirmAllergy ?? false,
      },
      { user: auth.getUserOrFail(), ip: request.ip() },
      { reason: i18n.t('orders.pos.reason') }
    )
    session.flash('success', i18n.t('orders.pos.saved'))
    return response.redirect().back()
  }

  /** POST /admin/pos/children/:childId/days/:date/cancel */
  async cancelDay(ctx: HttpContext) {
    const { request, response, auth, session, i18n } = ctx
    await this.school(ctx)
    const child = await this.child(ctx, Number(ctx.params.childId))
    await this.orders.cancelDay(
      child.id,
      this.date(ctx),
      { user: auth.getUserOrFail(), ip: request.ip() },
      { reason: i18n.t('orders.pos.reason') }
    )
    session.flash('success', i18n.t('orders.flash.staff_cancelled'))
    return response.redirect().back()
  }
}
