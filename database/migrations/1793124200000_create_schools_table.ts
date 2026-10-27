import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §schools. All §6 settings except school days and the school
 * year live in `settings` (jsonb), read through SchoolSettingsService which
 * deep-merges them over code defaults — so the column defaults to '{}'.
 */
export default class extends BaseSchema {
  protected tableName = 'schools'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.text('name').notNullable()
      table.text('slug').notNullable().unique()
      table.text('timezone').notNullable().defaultTo('Africa/Casablanca')
      table
        .specificType('school_days', 'smallint[]')
        .notNullable()
        .defaultTo(this.raw(`'{1,2,3,4,5}'::smallint[]`))
      table.date('school_year_start').notNullable()
      table.date('school_year_end').notNullable()
      table.jsonb('settings').notNullable().defaultTo(this.raw(`'{}'::jsonb`))
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    this.schema.raw(`
      ALTER TABLE schools
        ADD CONSTRAINT schools_school_days_check
          CHECK (school_days <@ '{1,2,3,4,5,6,7}'::smallint[] AND cardinality(school_days) > 0),
        ADD CONSTRAINT schools_school_year_check
          CHECK (school_year_end > school_year_start),
        ADD CONSTRAINT schools_settings_object_check
          CHECK (jsonb_typeof(settings) = 'object')
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
