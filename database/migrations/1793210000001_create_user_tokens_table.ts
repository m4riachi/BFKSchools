import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §user_tokens — invitation and password-reset links. Only the
 * SHA-256 hex of the random token is stored; the raw token exists only in
 * the email link. `used_at` makes a token single use, `revoked_at` is set on
 * older tokens when a new one is issued.
 */
export default class extends BaseSchema {
  protected tableName = 'user_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.text('type').notNullable()
      table.text('token_hash').notNullable().unique()
      table.timestamp('expires_at', { useTz: true }).notNullable()
      table.timestamp('used_at', { useTz: true }).nullable()
      table.timestamp('revoked_at', { useTz: true }).nullable()
      table.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.specificType('request_ip', 'inet').nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    this.schema.raw(`
      ALTER TABLE user_tokens
        ADD CONSTRAINT user_tokens_type_check CHECK (type IN ('invitation', 'password_reset')),
        ADD CONSTRAINT user_tokens_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
    `)
    this.schema.raw(`
      CREATE INDEX user_tokens_open_index ON user_tokens (user_id, type)
        WHERE used_at IS NULL AND revoked_at IS NULL
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
