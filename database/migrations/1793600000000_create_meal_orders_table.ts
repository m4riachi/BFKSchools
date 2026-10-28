import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §meal_orders (Phase 6). One row per child and day:
 * - no row = no selection yet;
 * - `active` = the child eats (items in meal_order_items);
 * - `cancelled` with `cancel_reason = 'absent'` = the parent chose "no meal
 *   this day" (the deadline auto-assign skips it); other reasons come from
 *   holidays, menu changes, staff or a deactivated child.
 * Orders are never deleted (history, statements): cancelling keeps the row.
 */
export default class extends BaseSchema {
  protected tableName = 'meal_orders'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('school_id')
        .notNullable()
        .references('id')
        .inTable('schools')
        .onDelete('RESTRICT')
      table
        .integer('child_id')
        .notNullable()
        .references('id')
        .inTable('children')
        .onDelete('RESTRICT')
      table.date('date').notNullable()
      table
        .integer('weekly_menu_id')
        .notNullable()
        .references('id')
        .inTable('weekly_menus')
        .onDelete('RESTRICT')
      table.text('status').notNullable().defaultTo('active')
      table.text('cancel_reason').nullable()
      table.text('cancel_note').nullable()
      table.timestamp('cancelled_at', { useTz: true }).nullable()
      table.text('origin').notNullable()
      table.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.integer('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    this.schema.raw(`
      ALTER TABLE meal_orders
        ADD CONSTRAINT meal_orders_child_date_unique UNIQUE (child_id, date),
        ADD CONSTRAINT meal_orders_status_check CHECK (status IN ('active', 'cancelled')),
        ADD CONSTRAINT meal_orders_cancel_reason_check
          CHECK (cancel_reason IS NULL OR cancel_reason IN
            ('absent', 'holiday', 'menu_change', 'staff', 'child_inactive')),
        ADD CONSTRAINT meal_orders_cancel_reason_status_check
          CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL)),
        ADD CONSTRAINT meal_orders_cancelled_at_check
          CHECK (status = 'active' OR cancelled_at IS NOT NULL),
        ADD CONSTRAINT meal_orders_origin_check CHECK (origin IN ('parent', 'staff', 'system')),
        ADD CONSTRAINT meal_orders_cancel_note_length_check
          CHECK (cancel_note IS NULL OR length(cancel_note) <= 500)
    `)
    this.schema.raw('CREATE INDEX meal_orders_date_status_index ON meal_orders (date, status)')
    this.schema.raw(
      'CREATE INDEX meal_orders_menu_status_index ON meal_orders (weekly_menu_id, status)'
    )
    this.schema.raw('CREATE INDEX meal_orders_school_date_index ON meal_orders (school_id, date)')
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
