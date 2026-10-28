import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §menu_templates, §menu_template_items (Phase 5). Reusable
 * week patterns stored **by ISO weekday** (1 = Monday), not by date.
 * Deleted or inactive meals stay referenced (FK RESTRICT) and are skipped
 * when the template is applied.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('menu_templates', (table) => {
      table.increments('id')
      table
        .integer('school_id')
        .notNullable()
        .references('id')
        .inTable('schools')
        .onDelete('CASCADE')
      table.text('name').notNullable()
      table.text('description').nullable()
      table.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })
    this.schema.raw(`
      ALTER TABLE menu_templates
        ADD CONSTRAINT menu_templates_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
        ADD CONSTRAINT menu_templates_description_check
          CHECK (description IS NULL OR length(description) <= 500)
    `)
    this.schema.raw(`
      CREATE UNIQUE INDEX menu_templates_school_name_unique
        ON menu_templates (school_id, lower(name))
    `)

    this.schema.createTable('menu_template_items', (table) => {
      table.increments('id')
      table
        .integer('menu_template_id')
        .notNullable()
        .references('id')
        .inTable('menu_templates')
        .onDelete('CASCADE')
      table.smallint('weekday').notNullable()
      table.integer('meal_id').notNullable().references('id').inTable('meals').onDelete('RESTRICT')
      table.text('meal_type').notNullable()
      table.smallint('position').notNullable().defaultTo(0)
      table.boolean('is_default').notNullable().defaultTo(false)
      table.integer('max_quantity').nullable()
    })
    this.schema.raw(`
      ALTER TABLE menu_template_items
        ADD CONSTRAINT menu_template_items_weekday_check CHECK (weekday BETWEEN 1 AND 7),
        ADD CONSTRAINT menu_template_items_meal_type_check
          CHECK (meal_type IN ('subscription', 'supplement')),
        ADD CONSTRAINT menu_template_items_default_subscription_check
          CHECK (NOT is_default OR meal_type = 'subscription'),
        ADD CONSTRAINT menu_template_items_max_quantity_check
          CHECK (max_quantity IS NULL OR max_quantity > 0),
        ADD CONSTRAINT menu_template_items_position_check CHECK (position >= 0),
        ADD CONSTRAINT menu_template_items_unique UNIQUE (menu_template_id, weekday, meal_id)
    `)
    this.schema.raw(`
      CREATE UNIQUE INDEX menu_template_items_one_default_per_day
        ON menu_template_items (menu_template_id, weekday) WHERE is_default
    `)
    this.schema.raw('CREATE INDEX menu_template_items_meal_index ON menu_template_items (meal_id)')
  }

  async down() {
    this.schema.dropTable('menu_template_items')
    this.schema.dropTable('menu_templates')
  }
}
