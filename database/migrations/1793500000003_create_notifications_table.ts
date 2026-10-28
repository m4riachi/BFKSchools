import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §notifications (Phase 5 table + NotificationService.notify;
 * the parent notification center comes in Phase 8). `data` holds ids and
 * i18n parameters only: the text is rendered at display time in the
 * reader's language. `dedupe_key` makes jobs safe to re-run.
 */
export default class extends BaseSchema {
  protected tableName = 'notifications'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.text('type').notNullable()
      table.jsonb('data').notNullable().defaultTo('{}')
      table.text('dedupe_key').nullable()
      table.timestamp('read_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
    })
    this.schema.raw(`
      ALTER TABLE notifications
        ADD CONSTRAINT notifications_type_check CHECK (type IN (
          'menu_published', 'deadline_reminder', 'holiday_cancellation',
          'order_changed_by_staff', 'menu_change', 'auto_assigned'
        )),
        ADD CONSTRAINT notifications_data_object_check CHECK (jsonb_typeof(data) = 'object'),
        ADD CONSTRAINT notifications_dedupe_key_length_check
          CHECK (dedupe_key IS NULL OR length(dedupe_key) BETWEEN 1 AND 200)
    `)
    this.schema.raw(`
      CREATE UNIQUE INDEX notifications_user_dedupe_unique
        ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
    `)
    this.schema.raw(
      'CREATE INDEX notifications_user_created_index ON notifications (user_id, created_at DESC)'
    )
    this.schema.raw(
      'CREATE INDEX notifications_unread_index ON notifications (user_id) WHERE read_at IS NULL'
    )
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
