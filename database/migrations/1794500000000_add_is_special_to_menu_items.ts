import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D47: a supplement on a menu day can be tagged "special of the day". The
 * tag is display only (parent portal and school board show it with the main
 * dishes): ordering, prices and billing do not change. Templates keep it.
 */
export default class extends BaseSchema {
  async up() {
    for (const table of ['menu_items', 'menu_template_items']) {
      this.schema.alterTable(table, (t) => {
        t.boolean('is_special').notNullable().defaultTo(false)
      })
      this.schema.raw(
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_special_supplement_check
           CHECK (NOT is_special OR meal_type = 'supplement')`
      )
    }
  }

  async down() {
    for (const table of ['menu_items', 'menu_template_items']) {
      this.schema.alterTable(table, (t) => {
        t.dropColumn('is_special')
      })
    }
  }
}
