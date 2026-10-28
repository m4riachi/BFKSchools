import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §outbound_emails (D16). Bulk/notification emails are inserted
 * here (OutboxService.enqueue) and sent by `node ace mail:dispatch` (cron,
 * every minute) with a per-run and per-hour cap, retries with backoff and
 * `failed` after the last attempt. `payload` holds ids only (the mail class
 * reloads its data when sending). Invitation and password-reset mails never
 * go through this table (the raw token must not be stored).
 */
export default class extends BaseSchema {
  protected tableName = 'outbound_emails'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.text('to_email').notNullable()
      table.text('locale').notNullable().defaultTo('fr')
      table.text('mail_key').notNullable()
      table.jsonb('payload').notNullable().defaultTo('{}')
      table.text('status').notNullable().defaultTo('pending')
      table.smallint('attempts').notNullable().defaultTo(0)
      table.text('last_error').nullable()
      table.timestamp('send_after', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('sent_at', { useTz: true }).nullable()
      table.text('dedupe_key').nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })
    this.schema.raw(`
      ALTER TABLE outbound_emails
        ADD CONSTRAINT outbound_emails_locale_check CHECK (locale IN ('fr', 'en')),
        ADD CONSTRAINT outbound_emails_status_check
          CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
        ADD CONSTRAINT outbound_emails_attempts_check CHECK (attempts BETWEEN 0 AND 100),
        ADD CONSTRAINT outbound_emails_payload_object_check CHECK (jsonb_typeof(payload) = 'object'),
        ADD CONSTRAINT outbound_emails_sent_at_check CHECK (status <> 'sent' OR sent_at IS NOT NULL),
        ADD CONSTRAINT outbound_emails_mail_key_check CHECK (mail_key ~ '^[a-z0-9_]{1,60}$'),
        ADD CONSTRAINT outbound_emails_dedupe_key_length_check
          CHECK (dedupe_key IS NULL OR length(dedupe_key) BETWEEN 1 AND 200)
    `)
    this.schema.raw(`
      CREATE UNIQUE INDEX outbound_emails_dedupe_unique
        ON outbound_emails (dedupe_key) WHERE dedupe_key IS NOT NULL
    `)
    this.schema.raw(`
      CREATE INDEX outbound_emails_queue_index
        ON outbound_emails (status, send_after) WHERE status IN ('pending', 'sending')
    `)
    this.schema.raw(`
      CREATE INDEX outbound_emails_sent_at_index
        ON outbound_emails (sent_at) WHERE sent_at IS NOT NULL
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
