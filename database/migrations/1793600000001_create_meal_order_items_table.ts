import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §meal_order_items (Phase 6). The lines of an order, with the
 * **price snapshot** taken when the line was added (`unit_price_cents`,
 * D1: each meal billed at its snapshot price). `line_total_cents` is a
 * generated column (integer centimes, never floats).
 *
 * At most one subscription meal per order (partial unique index) — the
 * database itself refuses two main meals for one child and day.
 */
export default class extends BaseSchema {
  protected tableName = 'meal_order_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('meal_order_id')
        .notNullable()
        .references('id')
        .inTable('meal_orders')
        .onDelete('CASCADE')
      table
        .integer('menu_item_id')
        .notNullable()
        .references('id')
        .inTable('menu_items')
        .onDelete('RESTRICT')
      table.integer('meal_id').notNullable().references('id').inTable('meals').onDelete('RESTRICT')
      table.text('meal_type').notNullable()
      table.smallint('quantity').notNullable().defaultTo(1)
      table.integer('unit_price_cents').notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    this.schema.raw(`
      ALTER TABLE meal_order_items
        ADD COLUMN line_total_cents integer GENERATED ALWAYS AS (quantity * unit_price_cents) STORED,
        ADD CONSTRAINT meal_order_items_order_menu_item_unique UNIQUE (meal_order_id, menu_item_id),
        ADD CONSTRAINT meal_order_items_meal_type_check
          CHECK (meal_type IN ('subscription', 'supplement')),
        ADD CONSTRAINT meal_order_items_quantity_check CHECK (quantity BETWEEN 1 AND 20),
        ADD CONSTRAINT meal_order_items_subscription_quantity_check
          CHECK (meal_type = 'supplement' OR quantity = 1),
        ADD CONSTRAINT meal_order_items_unit_price_check CHECK (unit_price_cents >= 0)
    `)
    this.schema.raw(`
      CREATE UNIQUE INDEX meal_order_items_one_subscription
        ON meal_order_items (meal_order_id) WHERE meal_type = 'subscription'
    `)
    this.schema.raw(
      'CREATE INDEX meal_order_items_menu_item_index ON meal_order_items (menu_item_id)'
    )
    this.schema.raw('CREATE INDEX meal_order_items_meal_index ON meal_order_items (meal_id)')
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
