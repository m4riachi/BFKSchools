import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §weekly_menus (Phase 5). One menu per school and week
 * (`week_start` = Monday). Status workflow:
 * draft → scheduled → published → closed, plus scheduled → draft.
 *
 * Idempotency columns for the scheduled jobs: `published_at`
 * (menus:publish-due), `closed_at` (menus:close-past), `reminder_sent_at`
 * (menus:send-reminders) and `deadline_processed_at` (menus:apply-deadline).
 */
export default class extends BaseSchema {
  protected tableName = 'weekly_menus'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('school_id')
        .notNullable()
        .references('id')
        .inTable('schools')
        .onDelete('CASCADE')
      table.date('week_start').notNullable()
      table.text('status').notNullable().defaultTo('draft')
      table.timestamp('publish_at', { useTz: true }).nullable()
      table.timestamp('order_deadline_at', { useTz: true }).nullable()
      table.timestamp('published_at', { useTz: true }).nullable()
      table.timestamp('closed_at', { useTz: true }).nullable()
      table.timestamp('reminder_sent_at', { useTz: true }).nullable()
      table.timestamp('deadline_processed_at', { useTz: true }).nullable()
      table.text('notes').nullable()
      table.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.integer('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    this.schema.raw(`
      ALTER TABLE weekly_menus
        ADD CONSTRAINT weekly_menus_school_week_unique UNIQUE (school_id, week_start),
        ADD CONSTRAINT weekly_menus_week_start_monday_check
          CHECK (extract(isodow FROM week_start) = 1),
        ADD CONSTRAINT weekly_menus_status_check
          CHECK (status IN ('draft', 'scheduled', 'published', 'closed')),
        ADD CONSTRAINT weekly_menus_deadline_after_publish_check
          CHECK (order_deadline_at IS NULL OR publish_at IS NULL OR order_deadline_at > publish_at),
        ADD CONSTRAINT weekly_menus_times_required_check
          CHECK (status = 'draft' OR (publish_at IS NOT NULL AND order_deadline_at IS NOT NULL)),
        ADD CONSTRAINT weekly_menus_published_at_check
          CHECK (status NOT IN ('published', 'closed') OR published_at IS NOT NULL),
        ADD CONSTRAINT weekly_menus_notes_length_check
          CHECK (notes IS NULL OR length(notes) <= 2000)
    `)
    this.schema.raw(`
      CREATE INDEX weekly_menus_due_index
        ON weekly_menus (status, publish_at) WHERE status = 'scheduled'
    `)
    this.schema.raw(`
      CREATE INDEX weekly_menus_open_index
        ON weekly_menus (status, order_deadline_at) WHERE status = 'published'
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
