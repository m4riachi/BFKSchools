import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D59: parent self-registration by QR code. A parent who signs up waits for
 * the school: `registration_status` = pending (account inactive), then
 * approved or refused by staff (who and when in `registration_reviewed_*`).
 * Null for every account created by staff or the CSV import.
 * The school's switch and link token live in `schools.settings`
 * (`registration_enabled`, `registration_token`), like the other settings.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('registration_status', 16).nullable()
      table.timestamp('registered_at', { useTz: true }).nullable()
      table.timestamp('registration_reviewed_at', { useTz: true }).nullable()
      table
        .integer('registration_reviewed_by')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
    })
    this.schema.raw(`
      ALTER TABLE users ADD CONSTRAINT users_registration_status_check
        CHECK (registration_status IS NULL OR (role = 'parent' AND registration_status IN ('pending', 'approved', 'refused')))
    `)
    // A pending or refused sign-up is never an active account.
    this.schema.raw(`
      ALTER TABLE users ADD CONSTRAINT users_registration_inactive_check
        CHECK (registration_status IS NULL OR registration_status = 'approved' OR is_active = false)
    `)
    this.schema.raw(`
      CREATE INDEX users_pending_registrations_idx ON users (school_id, registered_at)
        WHERE registration_status = 'pending'
    `)
  }

  async down() {
    this.schema.raw(`DROP INDEX IF EXISTS users_pending_registrations_idx`)
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('registration_reviewed_by')
      table.dropColumn('registration_reviewed_at')
      table.dropColumn('registered_at')
      table.dropColumn('registration_status')
    })
  }
}
