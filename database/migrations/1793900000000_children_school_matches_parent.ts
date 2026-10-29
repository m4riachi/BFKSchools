import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Phase 9 (Phase 2 review follow-up): a child always belongs to the school
 * of its parent account. Enforced by a composite foreign key
 * children (parent_id, school_id) → users (id, school_id); PostgreSQL needs
 * a unique constraint on the referenced pair (trivially unique: id is the
 * primary key). Moving a parent to another school while they have children
 * is refused (no UI does it).
 */
export default class extends BaseSchema {
  async up() {
    // Refuse with a readable message (instead of a bare FK violation) when
    // existing data breaks the rule: fix those children first.
    this.defer(async (db) => {
      const { rows } = await db.rawQuery(`
        SELECT c.id, c.school_id, u.school_id AS parent_school_id
        FROM children c JOIN users u ON u.id = c.parent_id
        WHERE u.school_id IS DISTINCT FROM c.school_id
        ORDER BY c.id
        LIMIT 20`)
      if (rows.length) {
        const list = rows
          .map(
            (row: { id: number; school_id: number; parent_school_id: number | null }) =>
              `child ${row.id} (school ${row.school_id}, parent's school ${row.parent_school_id ?? 'none'})`
          )
          .join('; ')
        throw new Error(
          `children_parent_school_fk: ${rows.length} child(ren) are not in their parent's school — ` +
            `set children.school_id to the parent's school (or fix the parent) first: ${list}`
        )
      }
    })
    this.schema.raw(`
      ALTER TABLE users
        ADD CONSTRAINT users_id_school_id_unique UNIQUE (id, school_id)
    `)
    this.schema.raw(`
      ALTER TABLE children
        ADD CONSTRAINT children_parent_school_fk
          FOREIGN KEY (parent_id, school_id) REFERENCES users (id, school_id)
          ON UPDATE RESTRICT ON DELETE RESTRICT
    `)
  }

  async down() {
    this.schema.raw(`ALTER TABLE children DROP CONSTRAINT children_parent_school_fk`)
    this.schema.raw(`ALTER TABLE users DROP CONSTRAINT users_id_school_id_unique`)
  }
}
