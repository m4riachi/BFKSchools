import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D59 review (L1): two children of the same school getting a code at the
 * same time could draw the same free code (each insert/update checks before
 * the other commits) and one would fail on `children_school_pin_unique`.
 * The trigger now takes a per-school advisory lock (key 7303, held until the
 * transaction ends) before looking for a free code. Same rules otherwise
 * (1795000000001): no code for a pending sign-up child at insert, a code when
 * a child without one becomes active, 50 random tries then a scan, then
 * `children_no_free_pin`.
 */
const FUNCTION_WITH_LOCK = `
  CREATE OR REPLACE FUNCTION children_assign_pin() RETURNS trigger AS $$
  DECLARE
    candidate text;
    tries int := 0;
  BEGIN
    IF NEW.pin IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.registration_pending THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NOT NEW.is_active THEN
      RETURN NEW;
    END IF;
    PERFORM pg_advisory_xact_lock(7303, NEW.school_id);
    LOOP
      tries := tries + 1;
      candidate := lpad(floor(random() * 10000)::int::text, 4, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM children WHERE school_id = NEW.school_id AND pin = candidate
      );
      IF tries >= 50 THEN
        SELECT lpad(n::text, 4, '0') INTO candidate
          FROM generate_series(0, 9999) AS n
         WHERE NOT EXISTS (
           SELECT 1 FROM children
            WHERE school_id = NEW.school_id AND pin = lpad(n::text, 4, '0')
         )
         ORDER BY random()
         LIMIT 1;
        IF candidate IS NULL THEN
          RAISE EXCEPTION 'children_no_free_pin' USING ERRCODE = 'P0001';
        END IF;
        EXIT;
      END IF;
    END LOOP;
    NEW.pin := candidate;
    RETURN NEW;
  END
  $$ LANGUAGE plpgsql
`

export default class extends BaseSchema {
  async up() {
    this.schema.raw(FUNCTION_WITH_LOCK)
  }

  async down() {
    this.schema.raw(
      FUNCTION_WITH_LOCK.replace(/\n\s*PERFORM pg_advisory_xact_lock\(7303, NEW\.school_id\);/, '')
    )
  }
}
