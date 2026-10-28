import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type User from '#models/user'
import Clock from '#services/clock'
import type { NotificationType } from '#enums/menus'

export type NotifyOptions = {
  /**
   * Idempotency key, unique per user (e.g. `menu_published:42`): a second
   * call with the same key creates nothing, so jobs can safely re-run.
   */
  dedupeKey?: string | null
  /** Run inside the caller's transaction. */
  client?: QueryClientContract
}

export type BulkNotification = {
  userId: number
  data?: Record<string, unknown>
  dedupeKey?: string | null
}

/** Rows per INSERT statement. */
const CHUNK = 500

/**
 * In-app notifications (docs/ERD.md §notifications). `data` carries ids and
 * i18n parameters only — the text is rendered when displayed, in the
 * reader's language (Phase 8 notification center). Used by Phase 5 (menu
 * published) and later phases (reminders, cancellations, staff changes).
 */
@inject()
export default class NotificationService {
  constructor(protected clock: Clock) {}

  /**
   * Creates one notification. Returns false when `dedupeKey` was already
   * used for this user (nothing is written).
   */
  async notify(
    user: Pick<User, 'id'> | number,
    type: NotificationType,
    data: Record<string, unknown> = {},
    options: NotifyOptions = {}
  ): Promise<boolean> {
    const userId = typeof user === 'number' ? user : user.id
    const created = await this.notifyMany(
      type,
      [{ userId, data, dedupeKey: options.dedupeKey ?? null }],
      options.client
    )
    return created === 1
  }

  /** Bulk version (one INSERT per 500 rows). Returns the number created. */
  async notifyMany(
    type: NotificationType,
    rows: BulkNotification[],
    client: QueryClientContract = db.connection()
  ): Promise<number> {
    const createdAt = this.clock.now().toISO()!
    let created = 0
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK).map((row) => ({
        user_id: row.userId,
        data: row.data ?? {},
        dedupe_key: row.dedupeKey ?? null,
      }))
      const result = await client.rawQuery(
        `INSERT INTO notifications (user_id, type, data, dedupe_key, created_at)
         SELECT r.user_id, ?, r.data, r.dedupe_key, ?::timestamptz
           FROM jsonb_to_recordset(?::jsonb) AS r(user_id integer, data jsonb, dedupe_key text)
         ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [type, createdAt, JSON.stringify(chunk)]
      )
      created += result.rows.length
    }
    return created
  }
}
