import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Phase 2 (security follow-up): a per-user credential version, bumped by the
 * User model when the password or email changes or the account is
 * deactivated. Sessions and the "known device" cookie are bound to it, so
 * they stop working after any of those changes.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('credentials_version').notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('credentials_version')
    })
  }
}
