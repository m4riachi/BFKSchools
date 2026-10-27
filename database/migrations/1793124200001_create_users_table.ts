import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §users. Roles and locales are text + CHECK (never PG enums);
 * TypeScript mirrors live in app/enums/roles.ts and app/enums/locales.ts.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('school_id').nullable().references('id').inTable('schools').onDelete('SET NULL')
      table.text('full_name').notNullable()
      table.text('email').notNullable()
      table.text('phone').nullable()
      // null until an invited user sets a password (Phase 2)
      table.text('password').nullable()
      table.text('role').notNullable().defaultTo('parent')
      table.text('locale').notNullable().defaultTo('fr')
      table.boolean('is_active').notNullable().defaultTo(true)
      table.jsonb('notification_prefs').notNullable().defaultTo(this.raw(`'{}'::jsonb`))
      table.timestamp('invited_at', { useTz: true }).nullable()
      table.timestamp('last_login_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.index(['role', 'is_active'], 'users_role_is_active_index')
    })

    this.schema.raw(`
      ALTER TABLE users
        ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'kitchen', 'parent')),
        ADD CONSTRAINT users_locale_check CHECK (locale IN ('fr', 'en')),
        ADD CONSTRAINT users_notification_prefs_object_check
          CHECK (jsonb_typeof(notification_prefs) = 'object')
    `)
    this.schema.raw(`CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email))`)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
