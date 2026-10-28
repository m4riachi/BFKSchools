import { inject } from '@adonisjs/core'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import type School from '#models/school'
import type User from '#models/user'
import Meal from '#models/meal'
import MenuItem from '#models/menu_item'
import type WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import SchoolSettingsService from '#services/school_settings_service'
import OrderAuditService, { orderSnapshot, type AuditEntry } from '#services/order_audit_service'
import OrderNotifier, { type Notice } from '#services/order_notifier'
import { allergyConflicts } from '#services/order_window_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import type { MealType } from '#enums/meals'
import type { IsoDate } from '#support/dates'

/** How the admin resolves the orders of an item removed from a published menu. */
export type RemovalResolution = { mode: 'switch'; targetItemId: number } | { mode: 'cancel' }

export type AffectedOrder = {
  orderId: number
  childId: number
  childName: string
  className: string | null
  grade: string | null
  parentName: string
  quantity: number
  allergies: string[]
}

export type RemovalOutcome = {
  orders: number
  switched: number
  cancelledOrders: number
  removedLines: number
  notifiedParents: number
}

type OrderLine = {
  id: number
  meal_order_id: number
  menu_item_id: number
  meal_id: number
  meal_type: MealType
  quantity: number
  unit_price_cents: number
}

/**
 * Changes to a **published** menu that touch families (D18, docs/PLAN.md
 * Phase 6 item 4). Always called by MenuBuilderService inside its
 * transaction (school `FOR SHARE`, menu `FOR UPDATE`), so no order can be
 * written meanwhile (orders take the menu `FOR SHARE`).
 *
 * - `affectedOrders`: active orders holding an item (shown before removing);
 * - `removeItem`: switch those orders to another meal of the same day and
 *   type, or cancel the lines (orders left empty are cancelled with reason
 *   `menu_change`); audited (`menu_change_switch` / `menu_change_cancel`, as
 *   the staff member), parents notified; the item gets `removed_at` when
 *   order lines still reference it, otherwise it is deleted;
 * - `assertMaxQuantity`: a cap can never go below what is already ordered;
 * - `notifyDefaultChange`: parents whose children would get the new default
 *   at the deadline are told.
 */
@inject()
export default class MenuChangeService {
  constructor(
    protected clock: Clock,
    protected settings: SchoolSettingsService,
    protected audit: OrderAuditService,
    protected notifier: OrderNotifier
  ) {}

  /** Portions of an item in active orders. */
  async orderedQuantity(client: QueryClientContract, menuItemId: number): Promise<number> {
    const row = await client
      .from('meal_order_items as moi')
      .join('meal_orders as mo', 'mo.id', 'moi.meal_order_id')
      .where('moi.menu_item_id', menuItemId)
      .where('mo.status', 'active')
      .sum('moi.quantity as total')
      .first()
    return Number(row?.total ?? 0)
  }

  /** D18: refuses a cap below the portions already ordered (item locked by the caller). */
  async assertMaxQuantity(client: QueryClientContract, menuItemId: number, max: number | null) {
    if (max === null) return
    const ordered = await this.orderedQuantity(client, menuItemId)
    if (max < ordered) {
      throw new BusinessRuleException('menus.errors.max_below_ordered', {
        field: 'maxQuantity',
        values: { ordered },
      })
    }
  }

  async affectedOrders(client: QueryClientContract, menuItemId: number): Promise<AffectedOrder[]> {
    const rows = await client
      .from('meal_order_items as moi')
      .join('meal_orders as mo', 'mo.id', 'moi.meal_order_id')
      .join('children as c', 'c.id', 'mo.child_id')
      .join('users as u', 'u.id', 'c.parent_id')
      .where('moi.menu_item_id', menuItemId)
      .where('mo.status', 'active')
      .orderBy('c.grade')
      .orderBy('c.class_name')
      .orderBy('c.last_name')
      .orderBy('c.first_name')
      .orderBy('mo.id')
      .select(
        'mo.id as order_id',
        'c.id as child_id',
        'c.first_name',
        'c.last_name',
        'c.class_name',
        'c.grade',
        'c.allergies',
        'u.full_name as parent_name',
        'moi.quantity'
      )
    return rows.map((row) => ({
      orderId: Number(row.order_id),
      childId: Number(row.child_id),
      childName: `${row.first_name} ${row.last_name}`,
      className: row.class_name ?? null,
      grade: row.grade ?? null,
      parentName: String(row.parent_name),
      quantity: Number(row.quantity),
      allergies: row.allergies ?? [],
    }))
  }

  /** Items of the same day and type an item's orders can be switched to. */
  async alternatives(client: QueryClientContract, item: MenuItem) {
    return MenuItem.query({ client })
      .withScopes((scopes) => scopes.current())
      .where('weekly_menu_id', item.weeklyMenuId)
      .where('date', item.date)
      .where('meal_type', item.mealType)
      .whereNot('id', item.id)
      .whereHas('meal', (meal) => meal.whereNull('deleted_at').where('is_active', true))
      .preload('meal')
      .orderBy('position')
      .orderBy('id')
  }

  /**
   * Removes `item` (locked by the caller) from a published menu, resolving
   * its active orders first. Refused for past days, and when orders exist
   * without a resolution (the admin must look at the impact page first).
   */
  async removeItem(
    trx: TransactionClientContract,
    school: School,
    menu: WeeklyMenu,
    item: MenuItem,
    actor: User,
    resolution: RemovalResolution | null
  ): Promise<RemovalOutcome> {
    const outcome: RemovalOutcome = {
      orders: 0,
      switched: 0,
      cancelledOrders: 0,
      removedLines: 0,
      notifiedParents: 0,
    }
    if (item.date < this.clock.today()) throw new BusinessRuleException('menus.errors.past_day')

    const orderRows = await trx
      .from('meal_order_items as moi')
      .join('meal_orders as mo', 'mo.id', 'moi.meal_order_id')
      .where('moi.menu_item_id', item.id)
      .where('mo.status', 'active')
      .orderBy('mo.id')
      .select('mo.id')
    const orderIds = orderRows.map((row) => Number(row.id))

    if (orderIds.length) {
      if (!resolution) {
        throw new BusinessRuleException('menus.errors.remove_has_orders', {
          values: { count: orderIds.length },
        })
      }
      Object.assign(
        outcome,
        await this.resolve(trx, school, menu, item, actor, resolution, orderIds)
      )
    }

    const referenced = await trx
      .from('meal_order_items')
      .where('menu_item_id', item.id)
      .select('id')
      .first()
    if (referenced) {
      await trx.from('menu_items').where('id', item.id).update({
        removed_at: this.clock.now().toISO()!,
        is_default: false,
        updated_at: this.clock.now().toISO()!,
      })
    } else {
      await trx.from('menu_items').where('id', item.id).delete()
    }
    return outcome
  }

  protected async resolve(
    trx: TransactionClientContract,
    school: School,
    menu: WeeklyMenu,
    item: MenuItem,
    actor: User,
    resolution: RemovalResolution,
    orderIds: number[]
  ) {
    const outcome = { orders: orderIds.length, switched: 0, cancelledOrders: 0, removedLines: 0 }
    // Same lock as OrderService (order rows FOR UPDATE, id order).
    const orders = await trx
      .from('meal_orders as mo')
      .join('children as c', 'c.id', 'mo.child_id')
      .whereIn('mo.id', orderIds)
      .orderBy('mo.id')
      .forUpdate('mo')
      .select('mo.id', 'mo.child_id', 'mo.date', 'c.parent_id', 'c.first_name', 'c.allergies')
    const lines = (await trx
      .from('meal_order_items')
      .whereIn('meal_order_id', orderIds)
      .select(
        'id',
        'meal_order_id',
        'menu_item_id',
        'meal_id',
        'meal_type',
        'quantity',
        'unit_price_cents'
      )) as OrderLine[]
    const linesOf = (orderId: number) => lines.filter((line) => line.meal_order_id === orderId)

    let target: MenuItem | null = null
    let targetMeal: Meal | null = null
    if (resolution.mode === 'switch') {
      target = await MenuItem.query({ client: trx })
        .withScopes((scopes) => scopes.current())
        .where('weekly_menu_id', menu.id)
        .where('id', resolution.targetItemId)
        .forUpdate()
        .first()
      if (
        !target ||
        target.id === item.id ||
        target.date !== item.date ||
        target.mealType !== item.mealType
      ) {
        throw new BusinessRuleException('menus.errors.switch_target', { field: 'targetItemId' })
      }
      targetMeal = await Meal.query({ client: trx })
        .withScopes((scopes) => scopes.offerable())
        .where('id', target.mealId)
        .forShare()
        .first()
      if (!targetMeal) {
        throw new BusinessRuleException('menus.errors.meal_unavailable', { field: 'targetItemId' })
      }
      // Capacity of the target for the portions that will move to it.
      if (target.maxQuantity !== null) {
        let needed = 0
        for (const order of orders) {
          if (allergyConflicts(targetMeal.allergens, order.allergies ?? []).length) continue
          needed += linesOf(Number(order.id)).find((l) => l.menu_item_id === item.id)?.quantity ?? 0
        }
        const remaining = target.maxQuantity - (await this.orderedQuantity(trx, target.id))
        if (needed > remaining) {
          throw new BusinessRuleException('menus.errors.switch_sold_out', {
            field: 'targetItemId',
            values: { remaining: Math.max(0, remaining) },
          })
        }
      }
    }

    const supplementMax = this.settings.get(school).supplement_max_quantity
    const now = this.clock.now().toISO()!
    const entries: AuditEntry[] = []
    const noticesByParent = new Map<number, { orderIds: number[]; children: string[] }>()

    for (const order of orders) {
      const orderId = Number(order.id)
      const current = linesOf(orderId)
      const removed = current.find((line) => line.menu_item_id === item.id)!
      const before = orderSnapshot('active', null, current.map(toSnapshotLine))
      let after = current.filter((line) => line.id !== removed.id)
      let switched = false

      const conflict =
        targetMeal !== null &&
        allergyConflicts(targetMeal.allergens, order.allergies ?? []).length > 0
      if (target && targetMeal && !conflict) {
        const existingTarget = current.find((line) => line.menu_item_id === target!.id)
        if (existingTarget) {
          const quantity = Math.min(existingTarget.quantity + removed.quantity, supplementMax)
          await trx
            .from('meal_order_items')
            .where('id', existingTarget.id)
            .update({ quantity, updated_at: now })
          await trx.from('meal_order_items').where('id', removed.id).delete()
          after = after.map((line) =>
            line.id === existingTarget.id ? { ...line, quantity } : line
          )
        } else {
          await trx.from('meal_order_items').where('id', removed.id).update({
            menu_item_id: target.id,
            meal_id: target.mealId,
            unit_price_cents: targetMeal.priceCents,
            updated_at: now,
          })
          after = [
            ...after,
            {
              ...removed,
              menu_item_id: target.id,
              meal_id: target.mealId,
              unit_price_cents: targetMeal.priceCents,
            },
          ]
        }
        switched = true
        outcome.switched += 1
      } else {
        await trx.from('meal_order_items').where('id', removed.id).delete()
        outcome.removedLines += 1
      }

      let status: 'active' | 'cancelled' = 'active'
      if (after.length === 0) {
        status = 'cancelled'
        await trx.from('meal_orders').where('id', orderId).update({
          status: 'cancelled',
          cancel_reason: 'menu_change',
          cancelled_at: now,
          updated_by: actor.id,
          updated_at: now,
        })
        outcome.cancelledOrders += 1
      } else {
        await trx
          .from('meal_orders')
          .where('id', orderId)
          .update({ updated_by: actor.id, updated_at: now })
      }
      entries.push({
        orderId,
        childId: Number(order.child_id),
        date: String(order.date),
        action: switched ? 'menu_change_switch' : 'menu_change_cancel',
        before,
        after:
          status === 'cancelled'
            ? orderSnapshot('cancelled', 'menu_change', [])
            : orderSnapshot('active', null, after.map(toSnapshotLine)),
        reason: `menu_item_removed:${item.id}`,
      })
      const entry = noticesByParent.get(Number(order.parent_id)) ?? { orderIds: [], children: [] }
      entry.orderIds.push(orderId)
      entry.children.push(String(order.first_name))
      noticesByParent.set(Number(order.parent_id), entry)
    }

    await this.audit.record(trx, { user: actor }, entries)
    const recipients = await this.notifier.recipients(trx, [...noticesByParent.keys()])
    const notices: Notice[] = []
    for (const [parentId, entry] of noticesByParent) {
      const recipient = recipients.get(parentId)
      if (!recipient) continue
      notices.push({
        recipient,
        data: {
          kind: 'item_removed',
          weeklyMenuId: menu.id,
          date: item.date,
          mealId: item.mealId,
          targetMealId: target?.mealId ?? null,
          orderIds: entry.orderIds,
          children: entry.children,
        },
        payload: {
          kind: 'item_removed',
          weeklyMenuId: menu.id,
          menuItemId: item.id,
          targetItemId: target?.id ?? null,
          orderIds: entry.orderIds,
        },
        dedupeKey: `menu_change:item:${item.id}`,
      })
    }
    await this.notifier.send(trx, school, 'menu_change', notices)
    return { ...outcome, notifiedParents: notices.length }
  }

  /**
   * D18: the default of `date` changed on a published menu (before the
   * deadline). Parents of active subscribed children without an order row
   * that day — those who would get the default at the deadline — are told.
   */
  async notifyDefaultChange(
    trx: TransactionClientContract,
    school: School,
    menu: WeeklyMenu,
    item: MenuItem
  ) {
    const date: IsoDate = item.date
    const rows = await trx.rawQuery(
      `SELECT DISTINCT u.id
         FROM children c
         JOIN users u ON u.id = c.parent_id
        WHERE c.school_id = ? AND c.is_active AND u.is_active AND u.role = 'parent'
          AND EXISTS (
            SELECT 1 FROM subscriptions s
             WHERE s.child_id = c.id AND s.status = 'active'
               AND s.start_date <= ?::date AND (s.end_date IS NULL OR s.end_date >= ?::date))
          AND NOT EXISTS (SELECT 1 FROM meal_orders o WHERE o.child_id = c.id AND o.date = ?::date)`,
      [school.id, date, date, date]
    )
    const recipients = await this.notifier.recipients(
      trx,
      rows.rows.map((row: { id: number }) => Number(row.id))
    )
    const stamp = this.clock.now().toMillis()
    const notices: Notice[] = [...recipients.values()].map((recipient) => ({
      recipient,
      data: { kind: 'default_changed', weeklyMenuId: menu.id, date, mealId: item.mealId },
      payload: { kind: 'default_changed', weeklyMenuId: menu.id, menuItemId: item.id },
      dedupeKey: `menu_change:default:${item.id}:${stamp}`,
    }))
    return this.notifier.send(trx, school, 'menu_change', notices)
  }
}

function toSnapshotLine(line: OrderLine) {
  return {
    menuItemId: Number(line.menu_item_id),
    mealId: Number(line.meal_id),
    mealType: line.meal_type,
    quantity: Number(line.quantity),
    unitPriceCents: Number(line.unit_price_cents),
  }
}
