import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * D59 security follow-up.
 *
 * - `users.email_confirmed_at`: a QR sign-up must prove it owns the email
 *   (single-use `email_confirmation` link) before staff can activate it.
 * - `children.registration_pending`: the children a sign-up created; only
 *   those are activated by the approval (never children staff deactivated
 *   or the import added).
 * - Kiosk codes are no longer spent on sign-ups waiting for the school:
 *   `children.pin` becomes nullable (an active child always has one, CHECK),
 *   the trigger gives none to a pending sign-up child and assigns one when a
 *   child without a code becomes active (approval, reactivation). It tries
 *   50 random codes, then scans for a free one, then raises
 *   `children_no_free_pin` (SQLSTATE P0001) instead of looping forever.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.timestamp('email_confirmed_at', { useTz: true }).nullable()
    })
    this.schema.raw(`
      ALTER TABLE user_tokens
        DROP CONSTRAINT user_tokens_type_check,
        ADD CONSTRAINT user_tokens_type_check
          CHECK (type IN ('invitation', 'password_reset', 'email_confirmation'))
    `)

    this.schema.alterTable('children', (table) => {
      table.boolean('registration_pending').notNullable().defaultTo(false)
    })
    this.schema.raw(`ALTER TABLE children ALTER COLUMN pin DROP NOT NULL`)
    this.schema.raw(`
      ALTER TABLE children ADD CONSTRAINT children_active_has_pin_check
        CHECK (NOT is_active OR pin IS NOT NULL)
    `)

    this.schema.raw(`
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
    `)
    this.schema.raw(`DROP TRIGGER IF EXISTS children_pin_default ON children`)
    this.schema.raw(`
      CREATE TRIGGER children_pin_default BEFORE INSERT OR UPDATE OF is_active, pin ON children
        FOR EACH ROW EXECUTE FUNCTION children_assign_pin()
    `)
  }

  async down() {
    this.schema.raw(`DROP TRIGGER IF EXISTS children_pin_default ON children`)
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
    this.schema.raw(`ALTER TABLE children DROP CONSTRAINT children_active_has_pin_check`)
    // Codes for the children that had none (sign-ups never approved), one row at a time.
    this.schema.raw(`
      DO $$
      DECLARE row record; code text;
      BEGIN
        FOR row IN SELECT id, school_id FROM children WHERE pin IS NULL ORDER BY id LOOP
          SELECT lpad(n::text, 4, '0') INTO code FROM generate_series(0, 9999) AS n
           WHERE NOT EXISTS (
             SELECT 1 FROM children WHERE school_id = row.school_id AND pin = lpad(n::text, 4, '0')
           )
           LIMIT 1;
          UPDATE children SET pin = code WHERE id = row.id;
        END LOOP;
      END
      $$
    `)
    this.schema.raw(`ALTER TABLE children ALTER COLUMN pin SET NOT NULL`)
    this.schema.alterTable('children', (table) => {
      table.dropColumn('registration_pending')
    })
    this.schema.raw(`
      DELETE FROM user_tokens WHERE type = 'email_confirmation'
    `)
    this.schema.raw(`
      ALTER TABLE user_tokens
        DROP CONSTRAINT user_tokens_type_check,
        ADD CONSTRAINT user_tokens_type_check CHECK (type IN ('invitation', 'password_reset'))
    `)
    this.schema.alterTable('users', (table) => {
      table.dropColumn('email_confirmed_at')
    })
  }
}
