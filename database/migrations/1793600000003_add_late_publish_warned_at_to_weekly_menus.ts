import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D19 (Phase 6 change to the Phase 5 table): the publish job no longer
 * publishes a scheduled menu whose order deadline has passed; it leaves it
 * `scheduled` and logs a warning **once**, remembered here.
 */
export default class extends BaseSchema {
  protected tableName = 'weekly_menus'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('late_publish_warned_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('late_publish_warned_at')
    })
  }
}
