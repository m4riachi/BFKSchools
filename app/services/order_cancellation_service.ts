import { inject } from '@adonisjs/core'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type User from '#models/user'
import School from '#models/school'
import Clock from '#services/clock'
import OrderAuditService, { orderSnapshot, type AuditActor } from '#services/order_audit_service'
import OrderNotifier, { type Notice } from '#services/order_notifier'
import type { MealType } from '#enums/meals'
import type { IsoDate } from '#support/dates'

type Line = {
  id: number
  meal_order_id: number
  menu_item_id: number
  meal_id: number
  meal_type: MealType
  quantity: number
  unit_price_cents: number
}

const toSnapshot = (line: Line) => ({
  menuItemId: Number(line.menu_item_id),
  mealId: Number(line.meal_id),
  mealType: line.meal_type,
  quantity: Number(line.quantity),
  unitPriceCents: Number(line.unit_price_cents),
})

export type CancellationOutcome = {
  cancelledOrders: number
  changedOrders: number
  notifiedParents: number
}

/**
 * Orders affected by back-office changes to a family (Phase 6 review M3):
 *
 * - a child (or its parent) is deactivated → every **future** active order
 *   of the child is cancelled (`cancel_reason = 'child_inactive'`);
 * - a subscription ends earlier / is paused / deleted → on future dates no
 *   longer covered, the subscription-meal line is removed (D2), and the
 *   order is cancelled (`subscription_ended`, re-orderable by the parent)
 *   when nothing remains.
 *
 * "Future" = dates **after today** (school time zone). Today's order is kept:
 * the kitchen is already preparing it; staff can still cancel it by hand.
 * Re-activating a child does not restore anything.
 *
 * Always runs inside the caller's transaction, after the caller locked the
 * child row(s) `FOR UPDATE` (same order as OrderService: child → orders).
 * Audited as the staff member (`staff_override`) or as system without one;
 * the parent is notified once (in-app + email, `order_changed_by_staff`).
 */
@inject()
export default class OrderCancellationService {
  constructor(
    protected clock: Clock,
    protected audit: OrderAuditService,
    protected notifier: OrderNotifier
  ) {}

  protected actorOf(actor: User | null | undefined): AuditActor {
    return actor ? { user: actor } : 'system'
  }

  protected async linesOf(trx: TransactionClientContract, orderIds: number[]): Promise<Line[]> {
    if (!orderIds.length) return []
    return (await trx
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
      )) as Line[]
  }

  /** Deactivated child(ren): cancel their future active orders. */
  async cancelFutureOrders(
    trx: TransactionClientContract,
    childIds: number[],
    actor: User | null | undefined
  ): Promise<CancellationOutcome> {
    const outcome = { cancelledOrders: 0, changedOrders: 0, notifiedParents: 0 }
    if (!childIds.length) return outcome
    const today = this.clock.today()
    const orders = await trx
      .from('meal_orders')
      .whereIn('child_id', childIds)
      .where('status', 'active')
      .where('date', '>', today)
      .orderBy('id')
      .forUpdate()
      .select('id', 'child_id', 'date', 'school_id')
    if (!orders.length) return outcome
    const ids = orders.map((row) => Number(row.id))
    const lines = await this.linesOf(trx, ids)
    const now = this.clock.now().toISO()!
    await trx
      .from('meal_orders')
      .whereIn('id', ids)
      .update({
        status: 'cancelled',
        cancel_reason: 'child_inactive',
        cancelled_at: now,
        updated_by: actor?.id ?? null,
        updated_at: now,
      })
    const auditIds = await this.audit.record(
      trx,
      this.actorOf(actor),
      orders.map((row) => ({
        orderId: Number(row.id),
        childId: Number(row.child_id),
        date: String(row.date),
        action: actor ? ('staff_override' as const) : ('cancel' as const),
        before: orderSnapshot(
          'active',
          null,
          lines.filter((l) => Number(l.meal_order_id) === Number(row.id)).map(toSnapshot)
        ),
        after: orderSnapshot('cancelled', 'child_inactive', []),
        reason: 'child_inactive',
      }))
    )
    outcome.cancelledOrders = orders.length
    outcome.notifiedParents = await this.notify(trx, orders, auditIds, 'child_inactive')
    return outcome
  }

  /**
   * After a subscription change of `childId`: remove the subscription-meal
   * line of future active orders on dates no longer covered by an active
   * subscription; cancel (`staff`) the orders left empty.
   */
  async trimUncoveredSubscriptionMeals(
    trx: TransactionClientContract,
    childId: number,
    actor: User | null | undefined
  ): Promise<CancellationOutcome> {
    const outcome = { cancelledOrders: 0, changedOrders: 0, notifiedParents: 0 }
    const today = this.clock.today()
    const orders = await trx
      .from('meal_orders as mo')
      .where('mo.child_id', childId)
      .where('mo.status', 'active')
      .where('mo.date', '>', today)
      .whereExists((sub) =>
        sub
          .from('meal_order_items as moi')
          .whereColumn('moi.meal_order_id', 'mo.id')
          .where('moi.meal_type', 'subscription')
      )
      .whereNotExists((sub) =>
        sub
          .from('subscriptions as s')
          .where('s.child_id', childId)
          .where('s.status', 'active')
          .whereColumn('s.start_date', '<=', 'mo.date')
          .where((q) => q.whereNull('s.end_date').orWhereColumn('s.end_date', '>=', 'mo.date'))
      )
      .orderBy('mo.id')
      .forUpdate()
      .select('mo.id', 'mo.child_id', 'mo.date', 'mo.school_id')
    if (!orders.length) return outcome
    const ids = orders.map((row) => Number(row.id))
    const lines = await this.linesOf(trx, ids)
    const now = this.clock.now().toISO()!
    await trx
      .from('meal_order_items')
      .whereIn('meal_order_id', ids)
      .where('meal_type', 'subscription')
      .delete()
    const entries = []
    for (const row of orders) {
      const own = lines.filter((l) => Number(l.meal_order_id) === Number(row.id))
      const kept = own.filter((l) => l.meal_type !== 'subscription')
      const empty = kept.length === 0
      if (empty) {
        await trx
          .from('meal_orders')
          .where('id', row.id)
          .update({
            status: 'cancelled',
            // N2: not 'staff' — the parent may re-order (extras, D2; or a
            // main meal once covered again): D24 does not lock this reason.
            cancel_reason: 'subscription_ended',
            cancel_note: null,
            cancelled_at: now,
            updated_by: actor?.id ?? null,
            updated_at: now,
          })
        outcome.cancelledOrders += 1
      } else {
        await trx
          .from('meal_orders')
          .where('id', row.id)
          .update({ updated_by: actor?.id ?? null, updated_at: now })
        outcome.changedOrders += 1
      }
      entries.push({
        orderId: Number(row.id),
        childId: Number(row.child_id),
        date: String(row.date) as IsoDate,
        action: actor ? ('staff_override' as const) : ('update' as const),
        before: orderSnapshot('active', null, own.map(toSnapshot)),
        after: empty
          ? orderSnapshot('cancelled', 'subscription_ended', [])
          : orderSnapshot('active', null, kept.map(toSnapshot)),
        reason: 'subscription_ended',
      })
    }
    const auditIds = await this.audit.record(trx, this.actorOf(actor), entries)
    outcome.notifiedParents = await this.notify(trx, orders, auditIds, 'subscription_ended')
    return outcome
  }

  /** One notice per parent (only active parents receive it). */
  protected async notify(
    trx: TransactionClientContract,
    orders: { id: number; child_id: number; date: string; school_id: number }[],
    auditIds: number[],
    kind: 'child_inactive' | 'subscription_ended'
  ) {
    const children = await trx
      .from('children')
      .whereIn('id', [...new Set(orders.map((row) => Number(row.child_id)))])
      .select('id', 'parent_id', 'first_name')
    const byChild = new Map(children.map((c) => [Number(c.id), c]))
    const byParent = new Map<
      number,
      { orderIds: number[]; days: { childName: string; date: string }[] }
    >()
    for (const row of orders) {
      const child = byChild.get(Number(row.child_id))
      if (!child) continue
      const entry = byParent.get(Number(child.parent_id)) ?? { orderIds: [], days: [] }
      entry.orderIds.push(Number(row.id))
      entry.days.push({ childName: String(child.first_name), date: String(row.date) })
      byParent.set(Number(child.parent_id), entry)
    }
    const recipients = await this.notifier.recipients(trx, [...byParent.keys()])
    const runKey = Math.min(...auditIds)
    const notices: Notice[] = []
    for (const [parentId, entry] of byParent) {
      const recipient = recipients.get(parentId)
      if (!recipient) continue
      notices.push({
        recipient,
        data: { kind, orderIds: entry.orderIds, days: entry.days },
        payload: { kind, orderIds: entry.orderIds },
        dedupeKey: `order_changed_by_staff:${kind}:${runKey}`,
      })
    }
    if (!notices.length) return 0
    const school = await School.findOrFail(Number(orders[0].school_id), { client: trx })
    await this.notifier.send(trx, school, 'order_changed_by_staff', notices)
    return notices.filter((n) => n.recipient.isActive).length
  }
}
