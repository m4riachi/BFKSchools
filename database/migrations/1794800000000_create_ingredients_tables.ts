import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D55: fiches techniques. `ingredients` is the BFK-wide catalog imported from
 * the kitchen's article list (active food/drinks only); `meal_ingredients`
 * is a meal's fiche technique — the ingredients it contains, each flagged
 * whether parents see it (`customer_visible`), in a chosen order.
 *
 * A parent may remove some of the shown ingredients when ordering: the
 * removal is snapshotted on the order line (`meal_order_items.excluded_ingredients`,
 * [{id,label}] so history renders without joins) and remembered on the child
 * (`children.disliked_ingredients`) to pre-apply it on the next order.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('ingredients', (table) => {
      table.increments('id')
      table.string('code', 60).notNullable().unique()
      table.string('label', 200).notNullable()
      table.string('category', 60).notNullable()
      table.string('famille', 120).nullable()
      table.string('sous_famille', 120).nullable()
      table.string('unit', 40).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.index('label')
    })

    this.schema.createTable('meal_ingredients', (table) => {
      table.increments('id')
      table.integer('meal_id').notNullable().references('id').inTable('meals').onDelete('CASCADE')
      table
        .integer('ingredient_id')
        .notNullable()
        .references('id')
        .inTable('ingredients')
        .onDelete('CASCADE')
      table.boolean('customer_visible').notNullable().defaultTo(false)
      table.integer('position').notNullable().defaultTo(0)
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.unique(['meal_id', 'ingredient_id'])
      table.index(['meal_id', 'position'])
    })

    this.schema.alterTable('meal_order_items', (table) => {
      table.jsonb('excluded_ingredients').notNullable().defaultTo('[]')
    })

    this.schema.alterTable('children', (table) => {
      table.specificType('disliked_ingredients', 'integer[]').notNullable().defaultTo('{}')
    })
  }

  async down() {
    this.schema.alterTable('children', (table) => table.dropColumn('disliked_ingredients'))
    this.schema.alterTable('meal_order_items', (table) => table.dropColumn('excluded_ingredients'))
    this.schema.dropTable('meal_ingredients')
    this.schema.dropTable('ingredients')
  }
}
