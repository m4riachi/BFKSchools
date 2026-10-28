import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §order_audit_logs (Phase 6). Append-only history of every
 * create / change / cancel of an order: who (actor, role at the time; null
 * actor = system), when, what before and after (jsonb snapshots of status
 * and lines), and the reason of staff overrides.
 */
export default class extends BaseSchema {
  protected tableName = 'order_audit_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('meal_order_id')
        .notNullable()
        .references('id')
        .inTable('meal_orders')
        .onDelete('RESTRICT')
      table.integer('child_id').notNullable()
      table.date('date').notNullable()
      table.integer('actor_id').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.text('actor_role').notNullable()
      table.text('action').notNullable()
      table.text('reason').nullable()
      table.jsonb('before').nullable()
      table.jsonb('after').nullable()
      table.specificType('ip_address', 'inet').nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    this.schema.raw(`
      ALTER TABLE order_audit_logs
        ADD CONSTRAINT order_audit_logs_actor_role_check
          CHECK (actor_role IN ('parent', 'admin', 'manager', 'system')),
        ADD CONSTRAINT order_audit_logs_action_check CHECK (action IN (
          'create', 'update', 'cancel', 'reactivate', 'auto_assign', 'holiday_cancel',
          'menu_change_switch', 'menu_change_cancel', 'staff_override'
        )),
        ADD CONSTRAINT order_audit_logs_system_actor_check
          CHECK (actor_role <> 'system' OR actor_id IS NULL),
        ADD CONSTRAINT order_audit_logs_reason_length_check
          CHECK (reason IS NULL OR length(reason) <= 500),
        ADD CONSTRAINT order_audit_logs_before_object_check
          CHECK (before IS NULL OR jsonb_typeof(before) = 'object'),
        ADD CONSTRAINT order_audit_logs_after_object_check
          CHECK (after IS NULL OR jsonb_typeof(after) = 'object')
    `)
    this.schema.raw(
      'CREATE INDEX order_audit_logs_order_created_index ON order_audit_logs (meal_order_id, created_at)'
    )
    this.schema.raw(
      'CREATE INDEX order_audit_logs_child_date_index ON order_audit_logs (child_id, date)'
    )
    this.schema.raw('CREATE INDEX order_audit_logs_created_index ON order_audit_logs (created_at)')
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
