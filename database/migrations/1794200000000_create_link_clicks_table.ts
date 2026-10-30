import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D38 — clicks of parents on the Glovo and home delivery buttons, for the
 * back-office reports. Only who, which button and when (no IP, no user agent).
 */
export default class extends BaseSchema {
  protected tableName = 'link_clicks'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')
      table
        .integer('school_id')
        .notNullable()
        .references('id')
        .inTable('schools')
        .onDelete('CASCADE')
      table.integer('user_id').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.text('link').notNullable()
      table.timestamp('clicked_at', { useTz: true }).notNullable()
      table.index(['school_id', 'clicked_at'])
    })
    this.schema.raw(`
      ALTER TABLE link_clicks
        ADD CONSTRAINT link_clicks_link_check CHECK (link IN ('glovo', 'delivery'))
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
