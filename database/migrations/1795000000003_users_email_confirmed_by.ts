import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D59 follow-up: staff can confirm a sign-up's email themselves (after
 * checking the parent by phone, WhatsApp or in person). `email_confirmed_by`
 * records who did; null when the parent clicked the link.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table
        .integer('email_confirmed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable('users', (table) => {
      table.dropColumn('email_confirmed_by')
    })
  }
}
