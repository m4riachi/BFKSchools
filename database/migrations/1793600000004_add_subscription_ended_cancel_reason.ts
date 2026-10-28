import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Phase 6 review N2: orders emptied because a subscription no longer covers
 * the day are cancelled with their own reason, `subscription_ended` — not
 * `staff`, which D24 locks for the parent (they may still order extras, D2).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      ALTER TABLE meal_orders
        DROP CONSTRAINT meal_orders_cancel_reason_check,
        ADD CONSTRAINT meal_orders_cancel_reason_check
          CHECK (cancel_reason IS NULL OR cancel_reason IN
            ('absent', 'holiday', 'menu_change', 'staff', 'child_inactive', 'subscription_ended'))
    `)
  }

  async down() {
    this.schema.raw(`
      UPDATE meal_orders SET cancel_reason = 'staff' WHERE cancel_reason = 'subscription_ended'
    `)
    this.schema.raw(`
      ALTER TABLE meal_orders
        DROP CONSTRAINT meal_orders_cancel_reason_check,
        ADD CONSTRAINT meal_orders_cancel_reason_check
          CHECK (cancel_reason IS NULL OR cancel_reason IN
            ('absent', 'holiday', 'menu_change', 'staff', 'child_inactive'))
    `)
  }
}
