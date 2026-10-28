import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §subscriptions. Periods of one child never overlap, enforced
 * by an exclusion constraint (needs btree_gist for `child_id WITH =`).
 * `end_date` null = open-ended (unbounded daterange). The app also checks
 * overlaps (SubscriptionService) to show a friendly error.
 *
 * The extension is created if missing (btree_gist is a trusted extension:
 * the database owner can create it) and never dropped on rollback — other
 * objects may use it.
 */
export default class extends BaseSchema {
  protected tableName = 'subscriptions'

  async up() {
    this.schema.raw('CREATE EXTENSION IF NOT EXISTS btree_gist')

    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('child_id')
        .notNullable()
        .references('id')
        .inTable('children')
        .onDelete('CASCADE')
      table.date('start_date').notNullable()
      table.date('end_date').nullable()
      table.text('status').notNullable().defaultTo('active')
      table.text('notes').nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.index(['child_id', 'start_date'], 'subscriptions_child_id_start_date_index')
    })

    this.schema.raw(`
      ALTER TABLE subscriptions
        ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('active', 'paused', 'ended')),
        ADD CONSTRAINT subscriptions_dates_check CHECK (end_date IS NULL OR end_date >= start_date),
        ADD CONSTRAINT subscriptions_no_overlap
          EXCLUDE USING gist (child_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
