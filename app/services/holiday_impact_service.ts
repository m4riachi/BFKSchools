import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { IsoDate } from '#support/dates'
import type User from '#models/user'

export type HolidayCancellationResult = { cancelledOrders: number; notifiedParents: number }

/**
 * Effect of new holiday dates on existing orders (brief §5.3: "show how many
 * orders are affected, ask for confirmation, cancel them (reason = holiday)
 * and notify the parents").
 *
 * PHASE 4 STUB — `meal_orders` does not exist yet, so nothing can be affected.
 *
 * INTEGRATION POINT (Phase 6, `bfk-parent-ordering`, docs/PLAN.md Phase 6 item 1):
 * - `countAffectedOrders`: count `meal_orders` with `status = 'active'` of
 *   children of `schoolId` on `dates`;
 * - `cancelAffectedOrders`: inside the caller's transaction (`trx`), cancel
 *   them (`cancel_reason = 'holiday'`), write one `order_audit_logs` row each
 *   (`holiday_cancel`, actor = `actor` or system), then notify the parents
 *   (notification + outbox email, not opt-out-able).
 *
 * Every caller already uses it: the back-office (create a holiday or range,
 * enable a disabled one, change a date, generate, ICS import) counts first,
 * asks for confirmation when the count is > 0 (`confirmImpact`), then cancels
 * inside the same transaction that writes the holidays; the
 * `holidays:generate` command cancels without asking (no one to ask).
 */
export default class HolidayImpactService {
  async countAffectedOrders(_schoolId: number, _dates: IsoDate[]): Promise<number> {
    return 0
  }

  async cancelAffectedOrders(
    _schoolId: number,
    _dates: IsoDate[],
    _options: { trx?: TransactionClientContract; actor?: User | null } = {}
  ): Promise<HolidayCancellationResult> {
    return { cancelledOrders: 0, notifiedParents: 0 }
  }
}
