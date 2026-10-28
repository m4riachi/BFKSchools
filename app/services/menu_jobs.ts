import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import MenuPublicationService, { type PublishOutcome } from '#services/menu_publication_service'
import OutboxService, { type DispatchResult } from '#services/outbox_service'
import OrderDeadlineService, {
  type DeadlineOutcome,
  type ReminderOutcome,
} from '#services/order_deadline_service'
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
    protected outbox: OutboxService,
    protected deadlines: OrderDeadlineService
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
          } else if (outcome.reason === 'deadline_passed' && outcome.firstWarning) {
            // D19: left scheduled; staff must set new times. Logged once.
            logger.warn(
              { menuId: outcome.menuId },
              'menus:publish-due: order deadline already passed, menu not published (set new times)'
            )
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
   * `menus:send-reminders` (every 5 min): `reminder_hours_before_deadline`
   * (D12: 24 h) before each published menu's deadline, notify + email the
   * parents who still have an active child without an order row on some
   * open day of that week. Once per menu (`reminder_sent_at`, dedupe keys).
   * See OrderDeadlineService.
   */
  async sendReminders(): Promise<Locked<ReminderOutcome[]>> {
    return withAdvisoryLock('menus:send-reminders', () => this.deadlines.sendReminders())
  }

  /**
   * `menus:apply-deadline` (every 5 min): at each published menu's order
   * deadline, auto-assign the day's default meal (D10) to subscribed
   * children without an order row; once per menu (`deadline_processed_at`).
   * See OrderDeadlineService.
   */
  async applyDeadline(): Promise<Locked<DeadlineOutcome[]>> {
    return withAdvisoryLock('menus:apply-deadline', () => this.deadlines.applyDeadline())
  }

  /** `mail:dispatch` (every minute): send due outbox emails within the caps. */
  async dispatchMail(): Promise<Locked<DispatchResult>> {
    return withAdvisoryLock('mail:dispatch', () => this.outbox.dispatch())
  }
}
