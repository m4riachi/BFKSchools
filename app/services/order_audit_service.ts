import { inject } from '@adonisjs/core'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type User from '#models/user'
import Clock from '#services/clock'
import type {
  AuditAction,
  AuditActorRole,
  CancelReason,
  OrderSnapshot,
  OrderSnapshotItem,
  OrderStatus,
} from '#enums/orders'
import type { MealType } from '#enums/meals'
import type { IsoDate } from '#support/dates'

/** Who did it: a logged-in user (parent or staff) or the system (jobs). */
export type AuditActor = { user: User; ip?: string | null } | 'system'

export type AuditEntry = {
  orderId: number
  childId: number
  date: IsoDate
  action: AuditAction
  before: OrderSnapshot | null
  after: OrderSnapshot | null
  reason?: string | null
}

type LineLike = {
  menuItemId: number
  mealId: number
  mealType: MealType
  quantity: number
  unitPriceCents: number
}

/** Snapshot of an order for the audit log (lines sorted by menu item). */
export function orderSnapshot(
  status: OrderStatus,
  cancelReason: CancelReason | null,
  lines: LineLike[]
): OrderSnapshot {
  const items: OrderSnapshotItem[] = [...lines]
    .sort((a, b) => a.menuItemId - b.menuItemId)
    .map((line) => ({
      menuItemId: line.menuItemId,
      mealId: line.mealId,
      mealType: line.mealType,
      qty: line.quantity,
      unitPriceCents: line.unitPriceCents,
    }))
  return { status, cancelReason, items }
}

/** IPv4/IPv6 literal accepted by the `inet` column, else null. */
function inetOrNull(ip: string | null | undefined) {
  if (!ip) return null
  return /^[\d.]{7,15}$/.test(ip) || /^[\da-f:.]{2,45}$/i.test(ip) ? ip : null
}

/**
 * Writes `order_audit_logs` rows (append-only; nothing in the app updates
 * or deletes them). Always called inside the transaction that changed the
 * order, so an order change and its audit row commit together.
 */
@inject()
export default class OrderAuditService {
  constructor(protected clock: Clock) {}

  actorRole(actor: AuditActor): AuditActorRole {
    if (actor === 'system') return 'system'
    const role = actor.user.role
    return role === 'admin' || role === 'manager' ? role : 'parent'
  }

  /** Inserts the rows; returns their ids in the same order. */
  async record(
    client: QueryClientContract,
    actor: AuditActor,
    entries: AuditEntry[]
  ): Promise<number[]> {
    if (!entries.length) return []
    const createdAt = this.clock.now().toISO()!
    const actorId = actor === 'system' ? null : actor.user.id
    const ip = actor === 'system' ? null : inetOrNull(actor.ip)
    const role = this.actorRole(actor)
    const ids: number[] = []
    for (let start = 0; start < entries.length; start += 500) {
      const chunk = entries.slice(start, start + 500).map((entry) => ({
        meal_order_id: entry.orderId,
        child_id: entry.childId,
        date: entry.date,
        actor_id: actorId,
        actor_role: role,
        action: entry.action,
        reason: entry.reason ? entry.reason.slice(0, 500) : null,
        before: entry.before,
        after: entry.after,
        ip_address: ip,
      }))
      const result = await client.rawQuery(
        `INSERT INTO order_audit_logs
           (meal_order_id, child_id, date, actor_id, actor_role, action, reason, before, after, ip_address, created_at)
         SELECT r.meal_order_id, r.child_id, r.date, r.actor_id, r.actor_role, r.action, r.reason,
                r.before, r.after, r.ip_address::inet, ?::timestamptz
           FROM jsonb_to_recordset(?::jsonb) AS r(
             meal_order_id integer, child_id integer, date date, actor_id integer, actor_role text,
             action text, reason text, before jsonb, after jsonb, ip_address text)
         RETURNING id`,
        [createdAt, JSON.stringify(chunk)]
      )
      ids.push(...result.rows.map((row: { id: number }) => Number(row.id)))
    }
    return ids
  }
}
