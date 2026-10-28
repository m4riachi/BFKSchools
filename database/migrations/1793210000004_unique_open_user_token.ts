import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * At most one open (unused, unrevoked) token per user and type, so two
 * concurrent resends/resets can never leave two valid links. Replaces the
 * plain partial index of the same shape. Older duplicates (if any) are
 * revoked first, keeping the newest.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      UPDATE user_tokens t SET revoked_at = now()
      WHERE t.used_at IS NULL AND t.revoked_at IS NULL
        AND EXISTS (
          SELECT 1 FROM user_tokens n
          WHERE n.user_id = t.user_id AND n.type = t.type
            AND n.used_at IS NULL AND n.revoked_at IS NULL AND n.id > t.id
        )
    `)
    this.schema.raw('DROP INDEX IF EXISTS user_tokens_open_index')
    this.schema.raw(`
      CREATE UNIQUE INDEX user_tokens_one_open_per_type ON user_tokens (user_id, type)
        WHERE used_at IS NULL AND revoked_at IS NULL
    `)
  }

  async down() {
    this.schema.raw('DROP INDEX IF EXISTS user_tokens_one_open_per_type')
    this.schema.raw(`
      CREATE INDEX user_tokens_open_index ON user_tokens (user_id, type)
        WHERE used_at IS NULL AND revoked_at IS NULL
    `)
  }
}
