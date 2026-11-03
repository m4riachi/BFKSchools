import { PurchaseOrderSchema } from '#database/schema'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import PurchaseOrderLine from '#models/purchase_order_line'

/** D56: a day's confirmed bon de commande for the économat. */
export default class PurchaseOrder extends PurchaseOrderSchema {
  @hasMany(() => PurchaseOrderLine)
  declare lines: HasMany<typeof PurchaseOrderLine>
}
