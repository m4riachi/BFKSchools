import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D56: économat / bon de commande. Each fiche-technique line gets a
 * `quantity_per_meal` (how much of the ingredient one portion needs, in the
 * ingredient's own unit). For a day, the kitchen gets a provisional purchase
 * list = Σ (meals ordered × quantity per meal) per ingredient; it edits it
 * and confirms it into a saved `purchase_orders` (+ lines), one per school
 * and day, reopenable and printable.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('meal_ingredients', (table) => {
      table.decimal('quantity_per_meal', 12, 3).notNullable().defaultTo(0)
    })

    this.schema.createTable('purchase_orders', (table) => {
      table.increments('id')
      table.integer('school_id').notNullable().references('id').inTable('schools')
      table.date('date').notNullable()
      table.string('reference', 40).notNullable()
      table.text('note').nullable()
      table.timestamp('confirmed_at', { useTz: true }).nullable()
      table.integer('confirmed_by').nullable().references('id').inTable('users')
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.unique(['school_id', 'date'])
    })

    this.schema.createTable('purchase_order_lines', (table) => {
      table.increments('id')
      table
        .integer('purchase_order_id')
        .notNullable()
        .references('id')
        .inTable('purchase_orders')
        .onDelete('CASCADE')
      table.integer('ingredient_id').nullable().references('id').inTable('ingredients')
      table.string('label', 200).notNullable()
      table.string('unit', 40).nullable()
      table.decimal('quantity', 12, 3).notNullable().defaultTo(0)
      table.integer('position').notNullable().defaultTo(0)
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.index(['purchase_order_id', 'position'])
    })
  }

  async down() {
    this.schema.dropTable('purchase_order_lines')
    this.schema.dropTable('purchase_orders')
    this.schema.alterTable('meal_ingredients', (table) => table.dropColumn('quantity_per_meal'))
  }
}
