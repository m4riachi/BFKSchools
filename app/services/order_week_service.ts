import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type Child from '#models/child'
import MealOrder from '#models/meal_order'
import MenuItem from '#models/menu_item'
import School from '#models/school'
import Subscription from '#models/subscription'
import User from '#models/user'
import WeeklyMenu from '#models/weekly_menu'
import OrderAuditLog from '#models/order_audit_log'
import Clock from '#services/clock'
import MenuCalendar from '#services/menu_calendar'
import SchoolSettingsService from '#services/school_settings_service'
import {
  describeOption,
  evaluate,
  staffCanOverride,
  staffMayChangeDate,
  type DayOption,
  type SelectionRules,
} from '#services/order_window_service'
import type { WindowReason } from '#enums/orders'
import type { AllergenCode } from '#enums/allergens'
import { addDays, type IsoDate } from '#support/dates'
import { formatMad } from '#support/money'
import { allergenLabels, mealCoverUrls, mealDescription, mealName } from '#support/meal_display'
import { schoolZone } from '#support/menu_display'

/** What the parent sees for one day (never computed by the browser). */
export type DayState = 'open' | 'locked' | 'holiday' | 'not_published' | 'no_meals'

function stateOf(reason: WindowReason | null): DayState {
  if (reason === null) return 'open'
  if (reason === 'NOT_SCHOOL_DAY') return 'no_meals'
  if (reason === 'HOLIDAY') return 'holiday'
  if (reason === 'NOT_PUBLISHED') return 'not_published'
  if (reason === 'NO_MEALS') return 'no_meals'
  return 'locked'
}

/**
 * Builds the week view of one child for the parent portal and the staff
 * "child's week" page: each day's state and reason (OrderWindowService),
 * the menu options with their flags (allergy, sold out, subscription), the
 * current order with its snapshot prices, and the week totals.
 *
 * Menu contents are only shown once the menu is published (a scheduled or
 * draft week never leaks its dishes). Read-only: writes go through
 * OrderService, which re-checks everything under locks.
 */
@inject()
export default class OrderWeekService {
  constructor(
    protected clock: Clock,
    protected calendar: MenuCalendar,
    protected settings: SchoolSettingsService
  ) {}

  async week(child: Child, weekStart: IsoDate, locale: string) {
    const school = await School.findOrFail(child.schoolId)
    const settings = this.settings.get(school)
    const zone = schoolZone(school)
    const now = this.clock.now()
    const weekEnd = addDays(weekStart, 6)
    const parent = await User.findOrFail(child.parentId)
    const menu = await WeeklyMenu.query()
      .where('school_id', school.id)
      .where('week_start', weekStart)
      .first()
    const visibleMenu = menu && ['published', 'closed'].includes(menu.status) ? menu : null
    const days = await this.calendar.days(school, weekStart)

    const items = visibleMenu
      ? await MenuItem.query()
          .withScopes((scopes) => scopes.current())
          .where('weekly_menu_id', visibleMenu.id)
          .preload('meal', (meal) =>
            meal.preload('photos', (photos) => photos.where('is_cover', true))
          )
          .orderBy('date')
          .orderBy('meal_type', 'asc')
          .orderBy('position')
          .orderBy('id')
      : []

    const orders = await MealOrder.query()
      .where('child_id', child.id)
      .whereBetween('date', [weekStart, weekEnd])
      .preload('items', (lines) => lines.preload('meal').orderBy('meal_type', 'asc').orderBy('id'))
    const orderByDate = new Map(orders.map((order) => [order.date, order]))

    const subscriptions = await Subscription.query().where('child_id', child.id)
    const hasSubscription = (date: IsoDate) => subscriptions.some((sub) => sub.covers(date))

    // Portions taken by other children (capped items only).
    const capped = items.filter((item) => item.maxQuantity !== null).map((item) => item.id)
    const elsewhere = new Map<number, number>()
    if (capped.length) {
      const rows = await db
        .from('meal_order_items as moi')
        .join('meal_orders as mo', 'mo.id', 'moi.meal_order_id')
        .whereIn('moi.menu_item_id', capped)
        .where('mo.status', 'active')
        .whereNot('mo.child_id', child.id)
        .groupBy('moi.menu_item_id')
        .select('moi.menu_item_id', db.raw('sum(moi.quantity)::int AS total'))
      for (const row of rows) elsewhere.set(Number(row.menu_item_id), Number(row.total))
    }

    const rules: SelectionRules = {
      allergyRule: settings.allergy_rule,
      supplementMaxQuantity: settings.supplement_max_quantity,
      subscriptionRequired: settings.subscription_required_for_main_meal,
    }
    const fr = locale === 'en' ? 'en' : 'fr'
    const money = (cents: number) => formatMad(cents, fr)

    const dayViews = days.map((day) => {
      const dayItems = items.filter((item) => item.date === day.date)
      const order = orderByDate.get(day.date) ?? null
      const activeLines = order?.status === 'active' ? order.items : []
      const decision = evaluate({
        date: day.date,
        now,
        zone,
        menu: menu ? { status: menu.status, orderDeadlineAt: menu.orderDeadlineAt } : null,
        hasMeals: dayItems.length > 0,
        isHoliday: day.state === 'holiday',
        isSchoolDay: day.state !== 'not_school_day',
        staffCancelled:
          order?.status === 'cancelled' &&
          (order.cancelReason === 'staff' || order.cancelReason === 'child_inactive'),
        settings,
        child: { isActive: child.isActive },
        parent: { isActive: parent.isActive },
      })
      const subscribed = hasSubscription(day.date)
      const options = dayItems.map((item) => {
        const option: DayOption = {
          menuItemId: item.id,
          mealId: item.mealId,
          mealType: item.mealType,
          isDefault: item.isDefault,
          maxQuantity: item.maxQuantity,
          mealAvailable: item.meal.isActive && !item.meal.deletedAt,
          allergens: item.meal.allergens,
          priceCents: item.meal.priceCents,
          orderedElsewhere: elsewhere.get(item.id) ?? 0,
        }
        const existingQty = activeLines.find((line) => line.menuItemId === item.id)?.quantity ?? 0
        const flags = describeOption(option, {
          childAllergies: child.allergies,
          hasSubscription: subscribed,
          rules,
          existingQty,
        })
        return {
          menuItemId: item.id,
          mealId: item.mealId,
          type: item.mealType,
          isDefault: item.isDefault,
          name: mealName(item.meal, locale),
          description: mealDescription(item.meal, locale),
          priceCents: item.meal.priceCents,
          price: money(item.meal.priceCents),
          allergens: allergenLabels(item.meal.allergens as AllergenCode[], locale),
          tags: [...item.meal.tags],
          cover: mealCoverUrls(item.meal),
          ...flags,
          allergyConflicts: allergenLabels(flags.allergyConflicts as AllergenCode[], locale),
          quantity: existingQty,
        }
      })
      const lines = (order?.items ?? []).map((line) => ({
        mealId: line.mealId,
        type: line.mealType,
        name: mealName(line.meal, locale),
        quantity: line.quantity,
        unitPrice: money(line.unitPriceCents),
        lineTotalCents: line.lineTotalCents ?? line.quantity * line.unitPriceCents,
      }))
      const totalCents =
        order?.status === 'active' ? lines.reduce((sum, line) => sum + line.lineTotalCents, 0) : 0
      return {
        date: day.date,
        state: stateOf(decision.reason),
        reason: decision.reason,
        editable: decision.allowed,
        // Back-office: what staff may change (time locks overridable, D23
        // current month only). Computed here so the UI never decides.
        staffEditable:
          decision.allowed ||
          (decision.reason !== null &&
            staffCanOverride(decision.reason, 'save') &&
            staffMayChangeDate(day.date, this.clock.today()) &&
            child.isActive &&
            parent.isActive &&
            dayItems.length > 0),
        editableUntil: decision.allowed ? (decision.editableUntil?.toISO() ?? null) : null,
        cutoffAt: decision.cutoffAt.toISO()!,
        holidayNames: day.holidayNames,
        hasSubscription: subscribed,
        options,
        order: order
          ? {
              id: order.id,
              status: order.status,
              cancelReason: order.cancelReason,
              origin: order.origin,
              lines: lines.map((line) => ({ ...line, lineTotal: money(line.lineTotalCents) })),
            }
          : null,
        totalCents,
        total: money(totalCents),
      }
    })

    const totalCents = dayViews.reduce((sum, day) => sum + day.totalCents, 0)
    return {
      school,
      menu: menu
        ? {
            status: menu.status,
            publishAt: menu.publishAt?.setZone(zone).toISO() ?? null,
            orderDeadlineAt: menu.orderDeadlineAt?.setZone(zone).toISO() ?? null,
            deadlinePassed: menu.orderDeadlineAt ? now >= menu.orderDeadlineAt : false,
          }
        : null,
      rules: {
        allergyRule: settings.allergy_rule,
        supplementMax: settings.supplement_max_quantity,
        allowParentEdits: settings.allow_parent_edits,
        editMode: settings.edit_mode,
        cutoffDaysBefore: settings.edit_cutoff_days_before,
      },
      allergies: allergenLabels(child.allergies, locale),
      days: dayViews,
      totalCents,
      total: money(totalCents),
    }
  }

  /** Total (active orders, snapshot prices) per child for a week, in centimes. */
  async weekTotals(childIds: number[], weekStart: IsoDate): Promise<Map<number, number>> {
    const totals = new Map<number, number>()
    if (!childIds.length) return totals
    const rows = await db
      .from('meal_order_items as moi')
      .join('meal_orders as mo', 'mo.id', 'moi.meal_order_id')
      .whereIn('mo.child_id', childIds)
      .where('mo.status', 'active')
      .whereBetween('mo.date', [weekStart, addDays(weekStart, 6)])
      .groupBy('mo.child_id')
      .select('mo.child_id', db.raw('sum(moi.line_total_cents)::int AS total'))
    for (const row of rows) totals.set(Number(row.child_id), Number(row.total))
    return totals
  }

  /** Audit trail of a child's week (staff page). */
  async auditTrail(childId: number, weekStart: IsoDate) {
    return OrderAuditLog.query()
      .where('child_id', childId)
      .whereBetween('date', [weekStart, addDays(weekStart, 6)])
      .preload('actor')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(100)
  }
}
