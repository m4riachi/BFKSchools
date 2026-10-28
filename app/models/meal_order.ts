import { MealOrderSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Child from '#models/child'
import WeeklyMenu from '#models/weekly_menu'
import MealOrderItem from '#models/meal_order_item'
import OrderAuditLog from '#models/order_audit_log'

/**
 * The order of one child for one day (docs/ERD.md §meal_orders). Written
 * only by OrderService and the order jobs (never deleted). A cancelled row
 * with `cancelReason = 'absent'` is the parent's "no meal this day".
 */
export default class MealOrder extends MealOrderSchema {
  @belongsTo(() => Child)
  declare child: BelongsTo<typeof Child>

  @belongsTo(() => WeeklyMenu)
  declare weeklyMenu: BelongsTo<typeof WeeklyMenu>

  @hasMany(() => MealOrderItem)
  declare items: HasMany<typeof MealOrderItem>

  @hasMany(() => OrderAuditLog)
  declare auditLogs: HasMany<typeof OrderAuditLog>

  get isActive() {
    return this.status === 'active'
  }
}
