import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D36 — keys of the external API, one pair per school. The public key finds
 * the school; the secret is encrypted with APP_KEY because admins can display
 * it again in the settings.
 */
export default class extends BaseSchema {
  protected tableName = 'school_api_keys'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('school_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('schools')
        .onDelete('CASCADE')
      table.text('public_key').notNullable().unique()
      table.text('secret_encrypted').notNullable()
      table
        .integer('generated_by')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('generated_at', { useTz: true }).notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
