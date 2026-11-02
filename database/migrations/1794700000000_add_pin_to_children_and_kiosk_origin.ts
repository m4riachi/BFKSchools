import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D51: ordering kiosk on the school board. Each child gets a 4-digit code,
 * unique within the school, typed on the board to order; existing children
 * get one (a permutation of their rank, so codes are unique and not
 * sequential). Orders placed there carry the origin `kiosk`.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('children', (table) => {
      table.string('pin', 4).nullable()
    })
    this.schema.raw(`
      UPDATE children c SET pin = lpad(((s.rn * 7919) % 10000)::text, 4, '0')
        FROM (SELECT id, row_number() OVER (PARTITION BY school_id ORDER BY id) AS rn FROM children) s
       WHERE s.id = c.id
    `)
    this.schema.raw(`ALTER TABLE children ALTER COLUMN pin SET NOT NULL`)
    this.schema.raw(
      `ALTER TABLE children ADD CONSTRAINT children_pin_check CHECK (pin ~ '^[0-9]{4}$')`
    )
    this.schema.raw(`CREATE UNIQUE INDEX children_school_pin_unique ON children (school_id, pin)`)
    this.schema.raw(`
      ALTER TABLE meal_orders
        DROP CONSTRAINT meal_orders_origin_check,
        ADD CONSTRAINT meal_orders_origin_check CHECK (origin IN ('parent', 'staff', 'system', 'kiosk'))
    `)
  }

  async down() {
    this.schema.raw(`
      ALTER TABLE meal_orders
        DROP CONSTRAINT meal_orders_origin_check,
        ADD CONSTRAINT meal_orders_origin_check CHECK (origin IN ('parent', 'staff', 'system'))
    `)
    this.schema.raw(`DROP INDEX children_school_pin_unique`)
    this.schema.alterTable('children', (table) => {
      table.dropColumn('pin')
    })
  }
}
