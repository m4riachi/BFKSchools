import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import MenuPublicationService, { type PublishOutcome } from '#services/menu_publication_service'
import OutboxService, { type DispatchResult } from '#services/outbox_service'
import { withAdvisoryLock } from '#support/advisory_lock'
import { addDays } from '#support/dates'

/**
 * Loggable fields of a job error: class name, pg/driver code and constraint
 * only — never the message or the raw object (they can carry SQL bindings,
 * i.e. addresses or names).
 */
export function safeJobError(error: unknown) {
  const err = (error ?? {}) as { name?: unknown; code?: unknown; constraint?: unknown }
  const clean = (value: unknown) =>
    typeof value === 'string' ? value.replace(/[^\w.:-]/g, '').slice(0, 80) : undefined
  return { name: clean(err.name), code: clean(err.code), constraint: clean(err.constraint) }
}

export type Locked<T> = { acquired: true; result: T } | { acquired: false }

/**
 * The scheduled jobs (docs/STACK_NOTES.md §7: Ace commands run by cron).
 * Each one:
 * - takes a PostgreSQL advisory lock named after its command and returns
 *   `{ acquired: false }` when another run holds it (no overlap);
 * - reads "now" from Clock (frozen in tests) and compares instants itself,
 *   so cron's time zone doesn't matter and a missed run is caught up by the
 *   next one ("publish everything due", "close every finished week");
 * - is idempotent (state columns + dedupe keys).
 */
@inject()
export default class MenuJobs {
  constructor(
    protected clock: Clock,
    protected publication: MenuPublicationService,
    protected outbox: OutboxService
  ) {}

  /** `menus:publish-due` (every 5 min): publish every scheduled menu whose publish_at has passed. */
  async publishDue(): Promise<Locked<PublishOutcome[]>> {
    return withAdvisoryLock('menus:publish-due', async () => {
      const now = this.clock.now()
      // Weeks already over are never published (menus:close-past moves them
      // back to draft and logs them once). Exact per-school check in publish().
      const due = await WeeklyMenu.query()
        .where('status', 'scheduled')
        .where('publish_at', '<=', now.toISO()!)
        .where('week_start', '>', addDays(this.clock.today(), -7))
        .orderBy('publish_at')
        .orderBy('id')
        .select('id')
      const outcomes: PublishOutcome[] = []
      for (const { id } of due) {
        try {
          const outcome = await this.publication.publish(id, { origin: 'job' })
          outcomes.push(outcome)
          if (outcome.published) {
            logger.info(outcome, 'menus:publish-due: menu published')
          } else if (outcome.reason === 'not_ready') {
            logger.warn(outcome, 'menus:publish-due: menu not ready, left scheduled')
          } else if (outcome.reason === 'week_over') {
            logger.warn(outcome, 'menus:publish-due: week already over, not published')
          }
        } catch (error) {
          // One broken menu must not block the others; the next run retries it.
          logger.error(
            { menuId: id, error: safeJobError(error) },
            'menus:publish-due: publication failed'
          )
        }
      }
      return outcomes
    })
  }

  /**
   * `menus:close-past` (daily): close published menus whose week is over.
   * Scheduled menus whose week ended without being published (never
   * announced) go back to `draft` (the allowed scheduled → draft
   * transition) with one warning each, so they don't stay "scheduled" forever.
   */
  async closePast(): Promise<Locked<{ closed: number; unscheduled: number }>> {
    return withAdvisoryLock('menus:close-past', async () => {
      const now = this.clock.now()
      const lastFinishedMonday = addDays(this.clock.today(), -7)
      const closed = await db
        .from('weekly_menus')
        .where('status', 'published')
        .where('week_start', '<=', lastFinishedMonday)
        .update({ status: 'closed', closed_at: now.toISO()!, updated_at: now.toISO()! })
      const count = Array.isArray(closed) ? closed.length : Number(closed)
      if (count) logger.info({ closed: count }, 'menus:close-past: menus closed')

      const stale = await db
        .from('weekly_menus')
        .where('status', 'scheduled')
        .where('week_start', '<=', lastFinishedMonday)
        .update({ status: 'draft', updated_at: now.toISO()! })
        .returning(['id', 'school_id', 'week_start'])
      for (const row of stale) {
        logger.warn(
          { menuId: row.id, schoolId: row.school_id, weekStart: row.week_start },
          'menus:close-past: scheduled menu of a past week was never published; moved back to draft'
        )
      }
      return { closed: count, unscheduled: stale.length }
    })
  }

  /**
   * `menus:send-reminders` (every 5 min) — PHASE 5 NO-OP.
   *
   * INTEGRATION POINT (Phase 6, `bfk-parent-ordering`, docs/PLAN.md Phase 6
   * item 2): for each published menu with `reminder_sent_at IS NULL` and
   * `now >= order_deadline_at − reminder_hours_before_deadline` (and
   * `now < order_deadline_at`), lock the menu, email (outbox, mail_key
   * `deadline_reminder`, dedupe `reminder:<menuId>:user:<id>`) + notify
   * (`deadline_reminder`) every parent with an active child lacking an order
   * row on some open day, respecting `email_notifications` and the parent's
   * `notification_prefs.deadline_reminder`; then set `reminder_sent_at`.
   * Until then it only reports the menus that would be due.
   */
  async sendReminders(): Promise<Locked<{ due: number; processed: 0 }>> {
    return withAdvisoryLock('menus:send-reminders', async () => {
      const now = this.clock.now().toISO()!
      const due = await WeeklyMenu.query()
        .where('status', 'published')
        .whereNull('reminder_sent_at')
        .where('order_deadline_at', '>', now)
        .count('* as total')
      return { due: Number(due[0]?.$extras.total ?? 0), processed: 0 as const }
    })
  }

  /**
   * `menus:apply-deadline` (every 5 min) — PHASE 5 NO-OP.
   *
   * INTEGRATION POINT (Phase 6, `bfk-parent-ordering`, docs/PLAN.md Phase 6
   * item 3): for each published menu with `deadline_processed_at IS NULL`
   * and `order_deadline_at <= now`, lock the menu; when
   * `auto_assign_default_meal` (D10) is on, create an order with the day's
   * default meal for every active child with a covering active subscription
   * and no order row on each open non-holiday day (snapshot prices, audit
   * `auto_assign`, skip sold-out defaults and report them, notify
   * `auto_assigned`); then set `deadline_processed_at` (also when the
   * setting is off). Until then it only reports the menus that would be due.
   */
  async applyDeadline(): Promise<Locked<{ due: number; processed: 0 }>> {
    return withAdvisoryLock('menus:apply-deadline', async () => {
      const now = this.clock.now().toISO()!
      const due = await WeeklyMenu.query()
        .where('status', 'published')
        .whereNull('deadline_processed_at')
        .where('order_deadline_at', '<=', now)
        .count('* as total')
      return { due: Number(due[0]?.$extras.total ?? 0), processed: 0 as const }
    })
  }

  /** `mail:dispatch` (every minute): send due outbox emails within the caps. */
  async dispatchMail(): Promise<Locked<DispatchResult>> {
    return withAdvisoryLock('mail:dispatch', () => this.outbox.dispatch())
  }
}
