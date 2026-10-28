import { BaseSchema } from '@adonisjs/lucid/schema'
import { ALLERGENS_SQL_ARRAY } from '#enums/allergens'

/**
 * docs/ERD.md §meals. A BFK-wide catalog (no school_id). Money in integer
 * centimes. Soft delete through `deleted_at` + explicit query scopes
 * (`Meal.catalog`), never a global hook: order history and statements
 * must still read deleted meals. Later FKs to meals use RESTRICT.
 */
export default class extends BaseSchema {
  protected tableName = 'meals'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.text('name_fr').notNullable()
      table.text('name_en').notNullable()
      table.text('description_fr').nullable()
      table.text('description_en').nullable()
      table.text('type').notNullable()
      table.text('category').notNullable()
      table.integer('price_cents').notNullable().defaultTo(0)
      table.specificType('allergens', 'text[]').notNullable().defaultTo(this.raw(`'{}'::text[]`))
      table.specificType('tags', 'text[]').notNullable().defaultTo(this.raw(`'{}'::text[]`))
      table.boolean('is_active').notNullable().defaultTo(true)
      table.text('external_recipe_ref').nullable()
      table.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('deleted_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    this.schema.raw(`
      ALTER TABLE meals
        ADD CONSTRAINT meals_type_check CHECK (type IN ('subscription', 'supplement')),
        ADD CONSTRAINT meals_category_check
          CHECK (category IN ('main', 'starter', 'dessert', 'drink', 'snack')),
        ADD CONSTRAINT meals_price_cents_check CHECK (price_cents >= 0),
        ADD CONSTRAINT meals_allergens_check CHECK (allergens <@ ${ALLERGENS_SQL_ARRAY}),
        ADD CONSTRAINT meals_name_fr_check CHECK (length(btrim(name_fr)) > 0),
        ADD CONSTRAINT meals_name_en_check CHECK (length(btrim(name_en)) > 0),
        ADD CONSTRAINT meals_deleted_inactive_check CHECK (deleted_at IS NULL OR NOT is_active)
    `)
    this.schema.raw(`
      CREATE INDEX meals_catalog_type_category_index
        ON meals (type, category) WHERE deleted_at IS NULL
    `)
    this.schema.raw(`
      CREATE INDEX meals_catalog_is_active_index
        ON meals (is_active) WHERE deleted_at IS NULL
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
