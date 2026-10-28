import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { IsoDate } from '#support/dates'
import type User from '#models/user'
import School from '#models/school'
import Clock from '#services/clock'
import OrderAuditService, { orderSnapshot } from '#services/order_audit_service'
import OrderNotifier, { type Notice } from '#services/order_notifier'
import type { MealType } from '#enums/meals'

export type HolidayCancellationResult = { cancelledOrders: number; notifiedParents: number }

/**
 * Effect of new holiday dates on existing orders (brief §5.3: "show how many
 * orders are affected, ask for confirmation, cancel them (reason = holiday)
 * and notify the parents").
 *
 * Every caller (back-office create / enable / move / generate / ICS import,
 * and the `holidays:generate` command) counts first, asks for confirmation
 * when the count is > 0, then — inside the transaction that writes the
 * holidays, after `lockSchool` (school row `FOR UPDATE`) — recounts
 * (HolidayService refuses when more orders exist than were confirmed) and
 * cancels. Orders take the same school row `FOR SHARE` (OrderService), so an
 * order and a holiday can never both commit for one date.
 */
@inject()
export default class HolidayImpactService {
  constructor(
    protected clock: Clock,
    protected audit: OrderAuditService,
    protected notifier: OrderNotifier
  ) {}

  /**
   * Only dates **after today** (school time zone) are affected: making a
   * past date a holiday (calendar correction) never rewrites orders that
   * were already served and billed (D23); today's orders are kept, as for
   * deactivations (the kitchen is preparing them).
   */
  protected futureOnly(dates: IsoDate[]): IsoDate[] {
    const today = this.clock.today()
    return [...new Set(dates)].filter((date) => date > today).sort()
  }

  /** Active orders of the school's children on these dates (future dates only). */
  async countAffectedOrders(
    schoolId: number,
    dates: IsoDate[],
    client: QueryClientContract = db.connection()
  ): Promise<number> {
    const unique = this.futureOnly(dates)
    if (!unique.length) return 0
    let total = 0
    for (let start = 0; start < unique.length; start += 500) {
      const row = await client
        .from('meal_orders')
        .where('school_id', schoolId)
        .whereIn('date', unique.slice(start, start + 500))
        .where('status', 'active')
        .count('* as total')
        .first()
      total += Number(row?.total ?? 0)
    }
    return total
  }

  /**
   * Cancels the active orders on `dates` (`cancel_reason = 'holiday'`),
   * writes one `holiday_cancel` audit row each (actor: the admin who
   * confirmed, or system when the command runs without one), and
   * notifies each parent once (in-app + email, not opt-out-able).
   */
  async cancelAffectedOrders(
    schoolId: number,
    dates: IsoDate[],
    options: { trx?: TransactionClientContract; actor?: User | null } = {}
  ): Promise<HolidayCancellationResult> {
    const unique = this.futureOnly(dates)
    if (!unique.length) return { cancelledOrders: 0, notifiedParents: 0 }
    const work = async (trx: TransactionClientContract) => {
      const now = this.clock.now().toISO()!
      const cancelled: { id: number; child_id: number; date: string }[] = []
      for (let start = 0; start < unique.length; start += 500) {
        const rows = await trx
          .from('meal_orders')
          .where('school_id', schoolId)
          .whereIn('date', unique.slice(start, start + 500))
          .where('status', 'active')
          .update({
            status: 'cancelled',
            cancel_reason: 'holiday',
            cancelled_at: now,
            updated_at: now,
            updated_by: null,
          })
          .returning(['id', 'child_id', 'date'])
        cancelled.push(...rows)
      }
      if (!cancelled.length) return { cancelledOrders: 0, notifiedParents: 0 }

      const orderIds = cancelled.map((row) => Number(row.id))
      const lines = await trx
        .from('meal_order_items')
        .whereIn('meal_order_id', orderIds)
        .select(
          'meal_order_id',
          'menu_item_id',
          'meal_id',
          'meal_type',
          'quantity',
          'unit_price_cents'
        )
      const linesByOrder = new Map<number, typeof lines>()
      for (const line of lines) {
        const list = linesByOrder.get(Number(line.meal_order_id)) ?? []
        list.push(line)
        linesByOrder.set(Number(line.meal_order_id), list)
      }
      const toLine = (line: (typeof lines)[number]) => ({
        menuItemId: Number(line.menu_item_id),
        mealId: Number(line.meal_id),
        mealType: line.meal_type as MealType,
        quantity: Number(line.quantity),
        unitPriceCents: Number(line.unit_price_cents),
      })
      // Audited as the admin who confirmed the holiday; as system when the
      // generator command runs without an actor.
      const auditIds = await this.audit.record(
        trx,
        options.actor ? { user: options.actor } : 'system',
        cancelled.map((row) => ({
          orderId: Number(row.id),
          childId: Number(row.child_id),
          date: String(row.date),
          action: 'holiday_cancel' as const,
          before: orderSnapshot(
            'active',
            null,
            (linesByOrder.get(Number(row.id)) ?? []).map(toLine)
          ),
          after: orderSnapshot('cancelled', 'holiday', []),
          reason: 'holiday',
        }))
      )

      // One notice per parent listing their cancelled days.
      const children = await trx
        .from('children')
        .whereIn('id', [...new Set(cancelled.map((row) => Number(row.child_id)))])
        .select('id', 'parent_id', 'first_name')
      const childById = new Map(children.map((child) => [Number(child.id), child]))
      const byParent = new Map<
        number,
        { orderIds: number[]; days: { childName: string; date: string }[] }
      >()
      for (const row of cancelled) {
        const child = childById.get(Number(row.child_id))
        if (!child) continue
        const entry = byParent.get(Number(child.parent_id)) ?? { orderIds: [], days: [] }
        entry.orderIds.push(Number(row.id))
        entry.days.push({ childName: String(child.first_name), date: String(row.date) })
        byParent.set(Number(child.parent_id), entry)
      }
      const recipients = await this.notifier.recipients(trx, [...byParent.keys()])
      // The first audit id makes the dedupe key unique per cancellation run.
      const runKey = Math.min(...auditIds)
      const notices: Notice[] = []
      for (const [parentId, entry] of byParent) {
        const recipient = recipients.get(parentId)
        if (!recipient) continue
        notices.push({
          recipient,
          data: { orderIds: entry.orderIds, days: entry.days },
          payload: { orderIds: entry.orderIds },
          dedupeKey: `holiday_cancellation:${runKey}`,
        })
      }
      const school = await School.findOrFail(schoolId, { client: trx })
      await this.notifier.send(trx, school, 'holiday_cancellation', notices)
      return { cancelledOrders: cancelled.length, notifiedParents: notices.length }
    }
    return options.trx ? work(options.trx) : db.transaction(work)
  }
}
