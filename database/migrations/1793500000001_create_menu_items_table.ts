import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §menu_items (Phase 5). One row per meal offered on one day of
 * a weekly menu. `meal_type` copies `meals.type` at insert (the type of a
 * meal used on a menu can no longer change, see MealService.update).
 *
 * - at most one default per day (partial unique index); "exactly one when
 *   the day has subscription meals" is kept by MenuBuilderService and
 *   checked again when scheduling;
 * - `removed_at`: Phase 6 sets it when an item that already has order
 *   items is removed (impact flow); items without orders are hard-deleted.
 */
export default class extends BaseSchema {
  protected tableName = 'menu_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('weekly_menu_id')
        .notNullable()
        .references('id')
        .inTable('weekly_menus')
        .onDelete('CASCADE')
      table.date('date').notNullable()
      table.integer('meal_id').notNullable().references('id').inTable('meals').onDelete('RESTRICT')
      table.text('meal_type').notNullable()
      table.smallint('position').notNullable().defaultTo(0)
      table.boolean('is_default').notNullable().defaultTo(false)
      table.integer('max_quantity').nullable()
      table.timestamp('removed_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    this.schema.raw(`
      ALTER TABLE menu_items
        ADD CONSTRAINT menu_items_meal_type_check
          CHECK (meal_type IN ('subscription', 'supplement')),
        ADD CONSTRAINT menu_items_default_subscription_check
          CHECK (NOT is_default OR meal_type = 'subscription'),
        ADD CONSTRAINT menu_items_max_quantity_check
          CHECK (max_quantity IS NULL OR max_quantity > 0),
        ADD CONSTRAINT menu_items_position_check CHECK (position >= 0)
    `)
    this.schema.raw(`
      CREATE UNIQUE INDEX menu_items_menu_date_meal_unique
        ON menu_items (weekly_menu_id, date, meal_id) WHERE removed_at IS NULL
    `)
    this.schema.raw(`
      CREATE UNIQUE INDEX menu_items_one_default_per_day
        ON menu_items (weekly_menu_id, date) WHERE is_default AND removed_at IS NULL
    `)
    this.schema.raw('CREATE INDEX menu_items_menu_date_index ON menu_items (weekly_menu_id, date)')
    this.schema.raw('CREATE INDEX menu_items_date_index ON menu_items (date)')
    this.schema.raw('CREATE INDEX menu_items_meal_index ON menu_items (meal_id)')
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
