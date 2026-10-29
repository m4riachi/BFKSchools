import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D31 (supersedes D1): subscription meals are free — no price, never
 * charged. Only supplements are priced and billed.
 *
 * - every subscription meal (deleted ones included) gets `price_cents = 0`;
 * - the price CHECK becomes: subscription ⇒ 0, supplement ⇒ > 0.
 *
 * Existing order lines (`meal_order_items.unit_price_cents`) are history and
 * are NOT rewritten; statements and totals ignore subscription lines anyway
 * (supplements only). New subscription lines snapshot 0.
 */
export default class extends BaseSchema {
  protected tableName = 'meals'

  async up() {
    this.schema.raw(
      `UPDATE meals SET price_cents = 0 WHERE type = 'subscription' AND price_cents <> 0`
    )
    this.schema.raw(`
      ALTER TABLE meals
        DROP CONSTRAINT meals_price_cents_check,
        ADD CONSTRAINT meals_price_cents_check CHECK (
          (type = 'subscription' AND price_cents = 0)
          OR (type = 'supplement' AND price_cents > 0)
        )
    `)
  }

  async down() {
    // Prices set to 0 by `up` are not restored (they are gone).
    this.schema.raw(`
      ALTER TABLE meals
        DROP CONSTRAINT meals_price_cents_check,
        ADD CONSTRAINT meals_price_cents_check CHECK (price_cents >= 0)
    `)
  }
}
