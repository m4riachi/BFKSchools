import { OrderAuditLogSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import MealOrder from '#models/meal_order'

/**
 * Append-only order history (docs/ERD.md §order_audit_logs). Rows are
 * inserted by OrderAuditService only; nothing updates or deletes them.
 */
export default class OrderAuditLog extends OrderAuditLogSchema {
  @belongsTo(() => MealOrder)
  declare order: BelongsTo<typeof MealOrder>

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>
}
