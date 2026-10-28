import { BaseSchema } from '@adonisjs/lucid/schema'
import { ALLERGENS_SQL_ARRAY } from '#enums/allergens'

/**
 * docs/ERD.md §children. One parent account per child (D8): all visibility
 * checks go through `Child.visibleTo()` / ChildPolicy so a guardians pivot
 * can replace `parent_id` later.
 */
export default class extends BaseSchema {
  protected tableName = 'children'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('parent_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')
      table
        .integer('school_id')
        .notNullable()
        .references('id')
        .inTable('schools')
        .onDelete('RESTRICT')
      table.text('first_name').notNullable()
      table.text('last_name').notNullable()
      table.text('grade').nullable()
      table.text('class_name').nullable()
      table.specificType('allergies', 'text[]').notNullable().defaultTo(this.raw(`'{}'::text[]`))
      table.text('dietary_notes').nullable()
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.index(['parent_id'], 'children_parent_id_index')
      table.index(['school_id', 'is_active'], 'children_school_id_is_active_index')
      table.index(['school_id', 'grade', 'class_name'], 'children_school_grade_class_index')
    })

    this.schema.raw(`
      ALTER TABLE children
        ADD CONSTRAINT children_allergies_check CHECK (allergies <@ ${ALLERGENS_SQL_ARRAY}),
        ADD CONSTRAINT children_first_name_check CHECK (length(btrim(first_name)) > 0),
        ADD CONSTRAINT children_last_name_check CHECK (length(btrim(last_name)) > 0)
    `)
    // CSV re-import matches a child on (parent, first name, last name).
    this.schema.raw(`
      CREATE UNIQUE INDEX children_parent_name_unique
        ON children (parent_id, lower(first_name), lower(last_name))
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
