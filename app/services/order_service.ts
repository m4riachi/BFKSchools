import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { errors as lucidErrors } from '@adonisjs/lucid'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Child from '#models/child'
import MealOrder from '#models/meal_order'
import MealOrderItem from '#models/meal_order_item'
import MenuItem from '#models/menu_item'
import School from '#models/school'
import User from '#models/user'
import WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import HolidayCalendar from '#services/holiday_calendar'
import SchoolSettingsService from '#services/school_settings_service'
import OrderAuditService, { orderSnapshot } from '#services/order_audit_service'
import OrderNotifier from '#services/order_notifier'
import {
  checkSelection,
  effectiveAllergyRule,
  evaluate,
  staffCanOverride,
  staffMayChangeDate,
  type DayOption,
  type SelectionRequest,
  type SelectionRules,
  type WindowDecision,
} from '#services/order_window_service'
import OrderRuleException from '#exceptions/order_rule_exception'
import { STAFF_ROLES } from '#enums/roles'
import type { AuditAction, CancelReason, WindowReason } from '#enums/orders'
import { isIsoDate, isSchoolDay, weekStart, type IsoDate } from '#support/dates'
import { schoolZone } from '#support/menu_display'

/** A logged-in user acting on an order (parent of the child, or staff of the school). */
export type OrderActor = { user: User; ip?: string | null }

export type SaveDayOptions = {
  /** Mandatory for staff (admin/manager): written to the audit log. */
  reason?: string | null
}

export type DayOutcome = {
  order: MealOrder
  /** null when nothing changed (no audit row). */
  action: AuditAction | null
}

export type ApplyResult =
  | { childId: number; ok: true; action: AuditAction | null }
  | {
      childId: number
      ok: false
      rule: string
      messageKey: string
      values?: Record<string, string | number>
    }

/** Max children in one "same choice for all my children" request. */
export const APPLY_MAX_CHILDREN = 10

/** Loaded and locked facts of one child-day (inside the transaction). */
type DayContext = {
  trx: TransactionClientContract
  school: School
  child: Child
  parent: User
  menu: WeeklyMenu | null
  order: MealOrder | null
  items: MenuItem[]
  isHoliday: boolean
  isSchoolDay: boolean
  date: IsoDate
  decision: WindowDecision
  staff: boolean
}

function isStaff(user: User) {
  return STAFF_ROLES.includes(user.role)
}

/**
 * Creates, changes and cancels the order of one child for one day
 * (brief §5.5/§5.6, docs/ERD.md §meal_orders). Each call runs in one
 * transaction with these locks, always in this order (shared with the menu
 * builder, the holiday writes and the order jobs, so they can't deadlock):
 *
 * 1. the school row `FOR SHARE` — holiday writes take it `FOR UPDATE`, so a
 *    day can't become a holiday while an order for it commits;
 * 2. the week's menu `FOR SHARE` — the builder, the publish/deadline jobs
 *    take it `FOR UPDATE` (item removals, default changes, auto-assign);
 * 3. the child row `FOR UPDATE` — serializes writes of one child (the
 *    "row lock on (child, date)", also when no order row exists yet);
 * 4. the order row `FOR UPDATE`;
 * 5. the selected menu items that have a `max_quantity` `FOR UPDATE` (id
 *    order), then the portions already ordered are summed — two parents
 *    can't both take the last portion.
 *
 * Every decision comes from OrderWindowService (window, then selection);
 * prices are read from the database and snapshotted; every change writes
 * one audit row. Staff may override time locks with a mandatory reason
 * (audited as `staff_override`, the parent is notified).
 */
@inject()
export default class OrderService {
  constructor(
    protected clock: Clock,
    protected holidays: HolidayCalendar,
    protected settings: SchoolSettingsService,
    protected audit: OrderAuditService,
    protected notifier: OrderNotifier
  ) {}

  selectionRules(school: School): SelectionRules {
    const settings = this.settings.get(school)
    return {
      allergyRule: effectiveAllergyRule(settings),
      supplementMaxQuantity: settings.supplement_max_quantity,
      subscriptionRequired: settings.subscription_required_for_main_meal,
    }
  }

  /** Does an active subscription of the child cover `date` (D2)? */
  async hasSubscription(
    client: TransactionClientContract | typeof db,
    childId: number,
    date: IsoDate
  ) {
    const row = await client
      .from('subscriptions')
      .where('child_id', childId)
      .where('status', 'active')
      .where('start_date', '<=', date)
      .where((query) => query.whereNull('end_date').orWhere('end_date', '>=', date))
      .select('id')
      .first()
    return Boolean(row)
  }

  /** Loads and locks everything about one child-day; refuses unknown/foreign children with a 404. */
  protected async context(
    trx: TransactionClientContract,
    childId: number,
    date: IsoDate,
    actor: OrderActor
  ): Promise<DayContext> {
    if (!isIsoDate(date)) throw new lucidErrors.E_ROW_NOT_FOUND()
    const visible = await Child.query({ client: trx })
      .withScopes((scopes) => scopes.visibleTo(actor.user))
      .where('children.id', childId)
      .select('children.id', 'children.school_id')
      .first()
    if (!visible) throw new lucidErrors.E_ROW_NOT_FOUND()

    const school = await School.query({ client: trx })
      .where('id', visible.schoolId)
      .forShare()
      .firstOrFail()
    const menu = await WeeklyMenu.query({ client: trx })
      .where('school_id', school.id)
      .where('week_start', weekStart(date))
      .forShare()
      .first()
    const child = await Child.query({ client: trx }).where('id', childId).forUpdate().firstOrFail()
    const parent = await User.findOrFail(child.parentId, { client: trx })
    const order = await MealOrder.query({ client: trx })
      .where('child_id', child.id)
      .where('date', date)
      .forUpdate()
      .first()
    if (order) await order.load('items')

    const items = menu
      ? await MenuItem.query({ client: trx })
          .withScopes((scopes) => scopes.current())
          .where('weekly_menu_id', menu.id)
          .where('date', date)
          .preload('meal')
          .orderBy('position')
          .orderBy('id')
      : []
    const isHoliday = await this.holidays.isHoliday(school.id, date, trx)
    // Same rule as MenuCalendar: a school weekday inside the school year.
    const schoolDay = isSchoolDay(date, {
      schoolDays: school.schoolDays,
      schoolYearStart: school.schoolYearStart,
      schoolYearEnd: school.schoolYearEnd,
    })
    const decision = evaluate({
      date,
      now: this.clock.now(),
      zone: schoolZone(school),
      menu: menu ? { status: menu.status, orderDeadlineAt: menu.orderDeadlineAt } : null,
      hasMeals: items.length > 0,
      isHoliday,
      isSchoolDay: schoolDay,
      staffCancelled:
        order?.status === 'cancelled' &&
        (order.cancelReason === 'staff' || order.cancelReason === 'child_inactive'),
      settings: this.settings.get(school),
      child: { isActive: child.isActive },
      parent: { isActive: parent.isActive },
    })
    return {
      trx,
      school,
      child,
      parent,
      menu,
      order,
      items,
      isHoliday,
      isSchoolDay: schoolDay,
      date,
      decision,
      staff: isStaff(actor.user),
    }
  }

  /**
   * The window must be open; staff may override a time lock (past day,
   * after the cutoff, edits disabled, same-day only) — never a holiday, an
   * unpublished day or a day without meals. Returns true when overriding.
   */
  protected assertWindow(context: DayContext, action: 'save' | 'cancel'): boolean {
    const { decision } = context
    if (decision.allowed) return false
    const reason = decision.reason as WindowReason
    if (!context.staff || !staffCanOverride(reason, action)) throw new OrderRuleException(reason)
    // D23: staff only change dates of the current month (school zone) or later.
    if (!staffMayChangeDate(context.date, this.clock.today())) {
      throw new OrderRuleException('STAFF_PERIOD_CLOSED')
    }
    // Structural locks hidden behind a time lock (evaluate() stops at the
    // first reason): a past holiday, a past week never published, …
    if (!context.isSchoolDay) throw new OrderRuleException('NOT_SCHOOL_DAY')
    if (context.isHoliday) throw new OrderRuleException('HOLIDAY')
    if (!context.menu || !['published', 'closed'].includes(context.menu.status)) {
      throw new OrderRuleException('NOT_PUBLISHED')
    }
    if (action === 'save') {
      if (context.items.length === 0) throw new OrderRuleException('NO_MEALS')
      if (!context.child.isActive || !context.parent.isActive) {
        throw new OrderRuleException('INACTIVE')
      }
    }
    return true
  }

  protected assertReason(actor: OrderActor, reason: string | null | undefined) {
    if (isStaff(actor.user) && !reason?.trim()) throw new OrderRuleException('REASON_REQUIRED')
  }

  /**
   * Portions of each item already taken by the other active orders, after
   * locking the items that have a cap (so the sum can't change under us).
   */
  protected async orderedElsewhere(
    trx: TransactionClientContract,
    menuItemIds: number[],
    excludeOrderId: number | null
  ): Promise<Map<number, number>> {
    const totals = new Map<number, number>()
    if (!menuItemIds.length) return totals
    await trx.from('menu_items').whereIn('id', menuItemIds).orderBy('id').forUpdate().select('id')
    const query = trx
      .from('meal_order_items as moi')
      .join('meal_orders as mo', 'mo.id', 'moi.meal_order_id')
      .whereIn('moi.menu_item_id', menuItemIds)
      .where('mo.status', 'active')
      .groupBy('moi.menu_item_id')
      .select('moi.menu_item_id', db.raw('sum(moi.quantity)::int AS total'))
    if (excludeOrderId !== null) query.whereNot('mo.id', excludeOrderId)
    for (const row of await query) totals.set(Number(row.menu_item_id), Number(row.total))
    return totals
  }

  /**
   * Saves the selection of one child for one day: a main (subscription)
   * meal and/or supplements with quantities. Creates the order, changes it,
   * or re-activates a cancelled day. Nothing changes (and nothing is
   * audited) when the selection equals the current active order.
   */
  async saveDay(
    childId: number,
    date: IsoDate,
    request: SelectionRequest,
    actor: OrderActor,
    options: SaveDayOptions = {}
  ): Promise<DayOutcome> {
    this.assertReason(actor, options.reason)
    return db.transaction(async (trx) => {
      const context = await this.context(trx, childId, date, actor)
      const overriding = this.assertWindow(context, 'save')
      const { order, items, child, school } = context

      const activeLines = order?.status === 'active' ? order.items : []
      const existing = activeLines.map((line) => ({
        menuItemId: line.menuItemId,
        qty: line.quantity,
      }))

      // Lock capped items among those requested, then count what others took.
      const requestedMealIds = new Set<number>([
        ...(request.subscriptionMealId !== null ? [request.subscriptionMealId] : []),
        ...request.supplements.map((supplement) => supplement.mealId),
      ])
      const capped = items
        .filter((item) => requestedMealIds.has(item.mealId) && item.maxQuantity !== null)
        .map((item) => item.id)
      const elsewhere = await this.orderedElsewhere(trx, capped, order?.id ?? null)

      // Lock the meals of the requested items: their price and availability
      // can't change before we commit (MealService.update locks FOR UPDATE).
      const requestedItems = items.filter((item) => requestedMealIds.has(item.mealId))
      if (requestedItems.length) {
        await trx
          .from('meals')
          .whereIn(
            'id',
            requestedItems.map((item) => item.mealId)
          )
          .orderBy('id')
          .forShare()
          .select('id')
        for (const item of requestedItems) await item.load('meal')
      }

      const dayOptions: DayOption[] = items.map((item) => ({
        menuItemId: item.id,
        mealId: item.mealId,
        mealType: item.mealType,
        isDefault: item.isDefault,
        maxQuantity: item.maxQuantity,
        mealAvailable: item.meal.isActive && !item.meal.deletedAt,
        allergens: item.meal.allergens,
        // D31: subscription meals are free (the DB CHECK keeps their price at 0).
        priceCents: item.mealType === 'supplement' ? item.meal.priceCents : 0,
        orderedElsewhere: elsewhere.get(item.id) ?? 0,
      }))
      const result = checkSelection({
        request,
        options: dayOptions,
        existing,
        childAllergies: child.allergies,
        hasSubscription: await this.hasSubscription(trx, child.id, date),
        rules: this.selectionRules(school),
      })
      if (!result.ok) {
        throw new OrderRuleException(result.error, result.values ?? {}, result.mealId ?? null)
      }

      // Nothing to do when the active order already has exactly these lines.
      const wanted = new Map(result.lines.map((line) => [line.option.menuItemId, line]))
      const unchanged =
        order?.status === 'active' &&
        activeLines.length === wanted.size &&
        activeLines.every((line) => wanted.get(line.menuItemId)?.qty === line.quantity)
      if (order && unchanged) return { order, action: null }

      const before = order
        ? orderSnapshot(
            order.status,
            order.cancelReason,
            order.status === 'active' ? activeLines : []
          )
        : null
      const now = this.clock.now()
      const actorId = actor.user.id
      let saved: MealOrder
      let action: AuditAction
      if (!order) {
        saved = await MealOrder.create(
          {
            schoolId: school.id,
            childId: child.id,
            date,
            weeklyMenuId: context.menu!.id,
            status: 'active',
            cancelReason: null,
            cancelNote: null,
            cancelledAt: null,
            origin: context.staff ? 'staff' : 'parent',
            createdBy: actorId,
            updatedBy: actorId,
          },
          { client: trx }
        )
        action = 'create'
      } else {
        saved = order
        action = order.status === 'cancelled' ? 'reactivate' : 'update'
        if (order.status === 'cancelled') {
          // A re-activated day is a new purchase: old lines go, new lines
          // get today's prices.
          await trx.from('meal_order_items').where('meal_order_id', order.id).delete()
        }
        saved.useTransaction(trx)
        saved.merge({
          status: 'active',
          // D39: the tag says who chose last.
          origin: context.staff ? 'staff' : 'parent',
          cancelReason: null,
          cancelNote: null,
          cancelledAt: null,
          updatedBy: actorId,
        })
        await saved.save()
      }

      // Diff the lines: keep the snapshot price of kept lines.
      const kept = order?.status === 'active' ? activeLines : []
      for (const line of kept) {
        const target = wanted.get(line.menuItemId)
        if (!target) {
          await trx.from('meal_order_items').where('id', line.id).delete()
        } else if (target.qty !== line.quantity) {
          await trx
            .from('meal_order_items')
            .where('id', line.id)
            .update({ quantity: target.qty, updated_at: now.toISO()! })
        }
      }
      const keptIds = new Set(kept.map((line) => line.menuItemId))
      for (const line of result.lines) {
        if (keptIds.has(line.option.menuItemId)) continue
        await MealOrderItem.create(
          {
            mealOrderId: saved.id,
            menuItemId: line.option.menuItemId,
            mealId: line.option.mealId,
            mealType: line.option.mealType,
            quantity: line.qty,
            unitPriceCents: line.option.priceCents,
          },
          { client: trx }
        )
      }

      await saved.load('items')
      const after = orderSnapshot('active', null, saved.items)
      const auditAction: AuditAction = context.staff ? 'staff_override' : action
      const [auditId] = await this.audit.record(trx, actor, [
        {
          orderId: saved.id,
          childId: child.id,
          date,
          action: auditAction,
          before,
          after,
          reason: context.staff ? (options.reason ?? null) : null,
        },
      ])
      if (context.staff) {
        await this.notifyStaffChange(context, saved, auditId, overriding)
      }
      return { order: saved, action: auditAction }
    })
  }

  /**
   * "No meal this day" (child absent) — or a staff cancellation. Keeps the
   * row (cancelled, reason `absent` / `staff`); when no order exists yet a
   * cancelled row is created so the deadline auto-assign skips the day.
   */
  async cancelDay(
    childId: number,
    date: IsoDate,
    actor: OrderActor,
    options: SaveDayOptions = {}
  ): Promise<DayOutcome> {
    this.assertReason(actor, options.reason)
    return db.transaction(async (trx) => {
      const context = await this.context(trx, childId, date, actor)
      const overriding = this.assertWindow(context, 'cancel')
      const { order, child, school } = context
      if (order?.status === 'cancelled') return { order, action: null }
      if (!context.menu) throw new OrderRuleException('NOT_PUBLISHED')

      const cancelReason: CancelReason = context.staff ? 'staff' : 'absent'
      const note = context.staff ? (options.reason?.trim().slice(0, 500) ?? null) : null
      const now = this.clock.now()
      const before = order ? orderSnapshot(order.status, order.cancelReason, order.items) : null
      let saved: MealOrder
      if (order) {
        saved = order
        saved.useTransaction(trx)
        saved.merge({
          status: 'cancelled',
          cancelReason,
          cancelNote: note,
          cancelledAt: now,
          updatedBy: actor.user.id,
        })
        await saved.save()
      } else {
        saved = await MealOrder.create(
          {
            schoolId: school.id,
            childId: child.id,
            date,
            weeklyMenuId: context.menu.id,
            status: 'cancelled',
            cancelReason,
            cancelNote: note,
            cancelledAt: now,
            origin: context.staff ? 'staff' : 'parent',
            createdBy: actor.user.id,
            updatedBy: actor.user.id,
          },
          { client: trx }
        )
      }
      // Lines of a cancelled order are kept for history (they no longer
      // count: statements and kitchen sheets read active orders only).
      const after = orderSnapshot('cancelled', cancelReason, [])
      const auditAction: AuditAction = context.staff ? 'staff_override' : 'cancel'
      const [auditId] = await this.audit.record(trx, actor, [
        {
          orderId: saved.id,
          childId: child.id,
          date,
          action: auditAction,
          before,
          after,
          reason: context.staff ? (options.reason ?? null) : null,
        },
      ])
      if (context.staff) await this.notifyStaffChange(context, saved, auditId, overriding)
      return { order: saved, action: auditAction }
    })
  }

  /**
   * "Same choice for all my children": applies one selection (by meal ids)
   * — or "no meal this day" — to several children for one date. Each child
   * is checked separately (own transaction, own window, allergies,
   * subscription, quantities) and gets its own result; a child the user
   * can't see is reported as NOT_FOUND without touching anything.
   */
  async applyToChildren(
    actor: OrderActor,
    date: IsoDate,
    selection: SelectionRequest | { absent: true },
    childIds: number[],
    options: SaveDayOptions = {}
  ): Promise<ApplyResult[]> {
    const ids = [...new Set(childIds)].slice(0, APPLY_MAX_CHILDREN)
    const visibleRows = await Child.query()
      .withScopes((scopes) => scopes.visibleTo(actor.user))
      .whereIn('children.id', ids)
      .select('children.id')
    const visible = new Set(visibleRows.map((child) => child.id))
    const results: ApplyResult[] = []
    for (const childId of ids) {
      if (!visible.has(childId)) {
        results.push({
          childId,
          ok: false,
          rule: 'NOT_FOUND',
          messageKey: 'orders.errors.NOT_FOUND',
        })
        continue
      }
      try {
        const outcome =
          'absent' in selection
            ? await this.cancelDay(childId, date, actor, options)
            : await this.saveDay(childId, date, selection, actor, options)
        results.push({ childId, ok: true, action: outcome.action })
      } catch (error) {
        if (error instanceof OrderRuleException) {
          results.push({
            childId,
            ok: false,
            rule: error.rule,
            messageKey: error.messageKey,
            values: error.options.values,
          })
        } else if (error instanceof lucidErrors.E_ROW_NOT_FOUND) {
          results.push({
            childId,
            ok: false,
            rule: 'NOT_FOUND',
            messageKey: 'orders.errors.NOT_FOUND',
          })
        } else {
          throw error
        }
      }
    }
    return results
  }

  protected async notifyStaffChange(
    context: DayContext,
    order: MealOrder,
    auditId: number,
    overriding: boolean
  ) {
    const recipients = await this.notifier.recipients(context.trx, [context.parent.id])
    const recipient = recipients.get(context.parent.id)
    if (!recipient) return
    await this.notifier.send(context.trx, context.school, 'order_changed_by_staff', [
      {
        recipient,
        data: {
          orderId: order.id,
          childId: context.child.id,
          childName: context.child.firstName,
          date: order.date,
          status: order.status,
          override: overriding,
        },
        payload: { auditId },
        dedupeKey: `order_changed_by_staff:audit:${auditId}`,
      },
    ])
  }
}
