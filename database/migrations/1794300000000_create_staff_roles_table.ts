import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D42 — custom roles of a school: a name and the back-office areas they open.
 * `users.role` stays the access level (manager or kitchen for these users), so
 * every data rule keeps working; permissions only narrow it.
 */
export default class extends BaseSchema {
  protected tableName = 'staff_roles'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('school_id')
        .notNullable()
        .references('id')
        .inTable('schools')
        .onDelete('CASCADE')
      table.text('name').notNullable()
      table.specificType('permissions', 'text[]').notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })
    this.schema.raw(
      `CREATE UNIQUE INDEX staff_roles_school_name_unique ON staff_roles (school_id, lower(name))`
    )
    this.schema.alterTable('users', (table) => {
      table
        .integer('staff_role_id')
        .nullable()
        .references('id')
        .inTable('staff_roles')
        .onDelete('RESTRICT')
      table.index(['staff_role_id'])
    })
  }

  async down() {
    this.schema.alterTable('users', (table) => {
      table.dropColumn('staff_role_id')
    })
    this.schema.dropTable(this.tableName)
  }
}
