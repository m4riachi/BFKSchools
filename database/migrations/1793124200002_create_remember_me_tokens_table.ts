import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Remember-me tokens of the session guard (shape from the @adonisjs/auth docs).
 */
export default class extends BaseSchema {
  protected tableName = 'remember_me_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('tokenable_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('hash').notNullable().unique()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.timestamp('expires_at', { useTz: true }).notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
