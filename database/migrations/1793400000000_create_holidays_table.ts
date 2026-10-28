import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §holidays. One row per closed school day.
 *
 * - `rule_key` is the idempotency key of generated/imported rows
 *   (`us_thanksgiving_2026`, `ma_throne_day_2027`, `ics:<uid hash>:<date>`):
 *   the generator inserts with ON CONFLICT DO NOTHING, and disabled
 *   (`is_active = false`) or deleted (`deleted_at` tombstone) rows keep their
 *   key, so a re-run never brings them back. Manual rows have no key and are
 *   hard-deleted.
 * - `group_id` ties the rows of one range ("Winter break") together.
 */
export default class extends BaseSchema {
  protected tableName = 'holidays'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('school_id')
        .notNullable()
        .references('id')
        .inTable('schools')
        .onDelete('CASCADE')
      table.date('date').notNullable()
      table.text('name').notNullable()
      table.text('source').notNullable()
      table.text('rule_key').nullable()
      table.uuid('group_id').nullable()
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('deleted_at', { useTz: true }).nullable()
      table.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    this.schema.raw(`
      ALTER TABLE holidays
        ADD CONSTRAINT holidays_source_check
          CHECK (source IN ('auto_us', 'auto_ma', 'import', 'manual')),
        ADD CONSTRAINT holidays_generated_rule_key_check
          CHECK (source NOT IN ('auto_us', 'auto_ma') OR rule_key IS NOT NULL),
        ADD CONSTRAINT holidays_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
        ADD CONSTRAINT holidays_rule_key_length_check
          CHECK (rule_key IS NULL OR length(rule_key) BETWEEN 1 AND 200),
        ADD CONSTRAINT holidays_school_rule_key_unique UNIQUE (school_id, rule_key)
    `)
    this.schema.raw(`
      CREATE UNIQUE INDEX holidays_school_date_name_unique
        ON holidays (school_id, date, name) WHERE deleted_at IS NULL
    `)
    this.schema.raw(`
      CREATE INDEX holidays_effective_index
        ON holidays (school_id, date) WHERE is_active AND deleted_at IS NULL
    `)
    this.schema.raw(`
      CREATE INDEX holidays_listed_index
        ON holidays (school_id, date) WHERE deleted_at IS NULL
    `)
    this.schema.raw(`
      CREATE INDEX holidays_group_index
        ON holidays (school_id, group_id) WHERE group_id IS NOT NULL
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
