import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D50: print jobs of the day's order tickets on the kitchen's receipt
 * printer. Direct mode: the server sends ESC/POS to the printer and records
 * the job as done/failed. Agent mode: the job waits (queued) for the print
 * agent running next to the printer, which fetches it through the API and
 * acknowledges it.
 */
export default class extends BaseSchema {
  protected tableName = 'ticket_print_jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('school_id')
        .notNullable()
        .references('id')
        .inTable('schools')
        .onDelete('CASCADE')
      table.date('date').notNullable()
      table.string('class_name', 120).nullable()
      table.string('locale', 5).notNullable().defaultTo('fr')
      table.boolean('with_amounts').notNullable().defaultTo(false)
      table.string('status', 20).notNullable().defaultTo('queued')
      table.integer('tickets_count').notNullable().defaultTo(0)
      table.text('error').nullable()
      table
        .integer('requested_by')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('printed_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.index(['school_id', 'status', 'id'])
    })
    this.schema.raw(
      `ALTER TABLE ticket_print_jobs ADD CONSTRAINT ticket_print_jobs_status_check
         CHECK (status IN ('queued', 'printing', 'done', 'failed'))`
    )
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
