import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D51: every path that creates a child (back-office form, CSV import,
 * seeders) gets a free 4-digit kiosk code from the database itself when
 * none is given, so the code can never be forgotten.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE OR REPLACE FUNCTION children_assign_pin() RETURNS trigger AS $$
      DECLARE candidate text;
      BEGIN
        IF NEW.pin IS NULL THEN
          LOOP
            candidate := lpad(floor(random() * 10000)::int::text, 4, '0');
            EXIT WHEN NOT EXISTS (
              SELECT 1 FROM children WHERE school_id = NEW.school_id AND pin = candidate
            );
          END LOOP;
          NEW.pin := candidate;
        END IF;
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `)
    this.schema.raw(`
      CREATE TRIGGER children_pin_default BEFORE INSERT ON children
        FOR EACH ROW EXECUTE FUNCTION children_assign_pin()
    `)
  }

  async down() {
    this.schema.raw(`DROP TRIGGER IF EXISTS children_pin_default ON children`)
    this.schema.raw(`DROP FUNCTION IF EXISTS children_assign_pin()`)
  }
}
