import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import MenuItem from '#models/menu_item'
import School from '#models/school'
import WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import MenuCalendar from '#services/menu_calendar'
import SchoolSettingsService from '#services/school_settings_service'
import OrderAuditService, { orderSnapshot } from '#services/order_audit_service'
import OrderNotifier, { type Notice } from '#services/order_notifier'
import { allergyConflicts, cutoffFor } from '#services/order_window_service'
import { schoolZone } from '#support/menu_display'
import type { DateTime } from 'luxon'

/**
 * A deadline run later than this after `order_deadline_at` (cron stopped)
 * no longer assigns days whose cutoff has passed (L7). The job runs every
 * 5 minutes, so an on-time run is always inside it.
 */
export const LATE_RUN_GRACE_MINUTES = 30

function latest(a: DateTime, b: DateTime) {
  return a >= b ? a : b
}
import type { IsoDate } from '#support/dates'

export type ReminderOutcome = { menuId: number; parents: number; emails: number }

export type DeadlineDayReport = {
  date: IsoDate
  assigned: number
  /** Why some (or all) children of the day got nothing. */
  skipped: {
    noDefault?: boolean
    mealUnavailable?: boolean
    soldOut?: number
    allergy?: number
    /** The job ran after the day's cutoff (and the deadline grace). */
    cutoffPassed?: boolean
  }
}

export type DeadlineOutcome = {
  menuId: number
  autoAssign: boolean
  assigned: number
  days: DeadlineDayReport[]
}

type Candidate = { id: number; parent_id: number; first_name: string; allergies: string[] }

/**
 * The order-dependent scheduled jobs of Phase 5 (docs/PLAN.md Phase 6
 * items 2 and 3), called by MenuJobs under their advisory locks:
 *
 * - **reminders** (`menus:send-reminders`): `reminder_hours_before_deadline`
 *   before the deadline, parents with an active child lacking an order row
 *   on some open day of the week get a notification + an email (once per
 *   menu: `reminder_sent_at`, dedupe keys);
 * - **deadline** (`menus:apply-deadline`, D10): at the deadline, every
 *   active child with a covering active subscription and **no order row**
 *   (a cancelled "absent" row is a choice) gets the day's default meal on
 *   each open, non-holiday day still ahead; prices are snapshotted, audit
 *   `auto_assign` as system; defaults that are sold out, unavailable, or
 *   contain the child's allergens are skipped and reported; once per menu
 *   (`deadline_processed_at`, also set when the setting is off).
 *
 * Locks: school `FOR SHARE`, then the menu `FOR UPDATE` (orders take it
 * `FOR SHARE`, so an order and the auto-assign never interleave), then the
 * capped default item `FOR UPDATE`. Inserts use ON CONFLICT (child, date)
 * DO NOTHING as a last guard.
 */
@inject()
export default class OrderDeadlineService {
  constructor(
    protected clock: Clock,
    protected calendar: MenuCalendar,
    protected settings: SchoolSettingsService,
    protected audit: OrderAuditService,
    protected notifier: OrderNotifier
  ) {}

  /** Open days of the menu that actually have meals. */
  protected async openDatesWithMeals(
    trx: TransactionClientContract,
    school: School,
    menu: WeeklyMenu
  ): Promise<IsoDate[]> {
    const days = await this.calendar.days(school, menu.weekStart, trx)
    const open = new Set(days.filter((day) => day.state === 'open').map((day) => day.date))
    const rows = await trx
      .from('menu_items')
      .where('weekly_menu_id', menu.id)
      .whereNull('removed_at')
      .distinct('date')
    return rows
      .map((row) => String(row.date))
      .filter((date) => open.has(date))
      .sort()
  }

  /* ---------------------------------------------------------------------- */
  /* Reminders                                                              */
  /* ---------------------------------------------------------------------- */

  async sendReminders(): Promise<ReminderOutcome[]> {
    const now = this.clock.now()
    const candidates = await WeeklyMenu.query()
      .where('status', 'published')
      .whereNull('reminder_sent_at')
      .where('order_deadline_at', '>', now.toISO()!)
      .preload('school')
      .orderBy('order_deadline_at')
      .orderBy('id')
    const outcomes: ReminderOutcome[] = []
    for (const candidate of candidates) {
      const hours = this.settings.get(candidate.school).reminder_hours_before_deadline
      if (now < candidate.orderDeadlineAt!.minus({ hours })) continue
      try {
        const outcome = await this.remindMenu(candidate.id)
        if (outcome) outcomes.push(outcome)
      } catch (error) {
        logger.error(
          { menuId: candidate.id, code: (error as { code?: string }).code },
          'menus:send-reminders: failed'
        )
      }
    }
    return outcomes
  }

  protected async remindMenu(menuId: number): Promise<ReminderOutcome | null> {
    return db.transaction(async (trx) => {
      const menu = await WeeklyMenu.query({ client: trx }).where('id', menuId).forUpdate().first()
      const now = this.clock.now()
      if (
        !menu ||
        menu.status !== 'published' ||
        menu.reminderSentAt ||
        !menu.orderDeadlineAt ||
        menu.orderDeadlineAt <= now
      ) {
        return null
      }
      const school = await School.findOrFail(menu.schoolId, { client: trx })
      const dates = await this.openDatesWithMeals(trx, school, menu)
      let parents = 0
      let emails = 0
      if (dates.length) {
        const rows = await trx.rawQuery(
          `SELECT DISTINCT u.id, u.email, u.locale, u.is_active, u.notification_prefs
             FROM users u
             JOIN children c ON c.parent_id = u.id
            WHERE u.role = 'parent' AND u.is_active AND u.school_id = ?
              AND c.is_active AND c.school_id = ?
              AND EXISTS (
                SELECT 1 FROM unnest(?::date[]) AS d(day)
                 WHERE NOT EXISTS (
                   SELECT 1 FROM meal_orders o WHERE o.child_id = c.id AND o.date = d.day))
            ORDER BY u.id`,
          [school.id, school.id, dates]
        )
        const notices: Notice[] = rows.rows.map(
          (row: {
            id: number
            email: string
            locale: string
            is_active: boolean
            notification_prefs: Record<string, unknown> | null
          }) => ({
            recipient: {
              id: Number(row.id),
              email: row.email,
              locale: row.locale,
              isActive: row.is_active,
              notificationPrefs: row.notification_prefs,
            },
            data: { weeklyMenuId: menu.id, weekStart: menu.weekStart },
            payload: { weeklyMenuId: menu.id },
            dedupeKey: `deadline_reminder:${menu.id}`,
          })
        )
        const sent = await this.notifier.send(trx, school, 'deadline_reminder', notices)
        parents = notices.length
        emails = sent.emails
      }
      menu.useTransaction(trx)
      menu.reminderSentAt = now
      await menu.save()
      return { menuId: menu.id, parents, emails }
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Deadline (auto-assign the default meal, D10)                            */
  /* ---------------------------------------------------------------------- */

  async applyDeadline(): Promise<DeadlineOutcome[]> {
    const now = this.clock.now()
    const due = await WeeklyMenu.query()
      .where('status', 'published')
      .whereNull('deadline_processed_at')
      .where('order_deadline_at', '<=', now.toISO()!)
      .orderBy('order_deadline_at')
      .orderBy('id')
      .select('id')
    const outcomes: DeadlineOutcome[] = []
    for (const { id } of due) {
      try {
        const outcome = await this.processMenu(id)
        if (outcome) {
          outcomes.push(outcome)
          const skipped = outcome.days.filter((day) => Object.keys(day.skipped).length)
          if (skipped.length) {
            logger.warn(
              { menuId: id, days: skipped },
              'menus:apply-deadline: some defaults not assigned'
            )
          }
        }
      } catch (error) {
        logger.error(
          { menuId: id, code: (error as { code?: string }).code },
          'menus:apply-deadline: failed'
        )
      }
    }
    return outcomes
  }

  async processMenu(menuId: number): Promise<DeadlineOutcome | null> {
    return db.transaction(async (trx) => {
      const head = await trx.from('weekly_menus').where('id', menuId).select('school_id').first()
      if (!head) return null
      const school = await School.query({ client: trx })
        .where('id', head.school_id)
        .forShare()
        .firstOrFail()
      const menu = await WeeklyMenu.query({ client: trx }).where('id', menuId).forUpdate().first()
      const now = this.clock.now()
      if (
        !menu ||
        menu.status !== 'published' ||
        menu.deadlineProcessedAt ||
        !menu.orderDeadlineAt ||
        menu.orderDeadlineAt > now
      ) {
        return null
      }
      const outcome: DeadlineOutcome = {
        menuId,
        autoAssign: this.settings.get(school).auto_assign_default_meal,
        assigned: 0,
        days: [],
      }
      if (outcome.autoAssign) {
        const today = this.clock.today()
        const openDates = await this.openDatesWithMeals(trx, school, menu)
        const settings = this.settings.get(school)
        const zone = schoolZone(school)
        const notices = new Map<number, { childName: string; date: IsoDate; mealId: number }[]>()
        for (const date of openDates.filter((d) => d >= today)) {
          // L7: a late run (cron stopped) must not add meals to a day the
          // kitchen already locked. A day whose cutoff falls before the
          // deadline (D5: Monday's cutoff Sunday 18:00 < deadline 20:00) is
          // still assigned when the job runs on time (within the grace).
          const lock = latest(
            cutoffFor(date, settings, zone),
            menu.orderDeadlineAt.plus({ minutes: LATE_RUN_GRACE_MINUTES })
          )
          if (now >= lock) {
            outcome.days.push({ date, assigned: 0, skipped: { cutoffPassed: true } })
            continue
          }
          const report = await this.assignDay(trx, school, menu, date, notices)
          outcome.days.push(report)
          outcome.assigned += report.assigned
        }
        if (notices.size) {
          const recipients = await this.notifier.recipients(trx, [...notices.keys()])
          await this.notifier.send(
            trx,
            school,
            'auto_assigned',
            [...notices.entries()]
              .filter(([parentId]) => recipients.has(parentId))
              .map(([parentId, days]) => ({
                recipient: recipients.get(parentId)!,
                data: { weeklyMenuId: menu.id, weekStart: menu.weekStart, days },
                payload: {},
                dedupeKey: `auto_assigned:${menu.id}`,
              })),
            { email: false }
          )
        }
      }
      menu.useTransaction(trx)
      menu.deadlineProcessedAt = now
      await menu.save()
      return outcome
    })
  }

  protected async assignDay(
    trx: TransactionClientContract,
    school: School,
    menu: WeeklyMenu,
    date: IsoDate,
    notices: Map<number, { childName: string; date: IsoDate; mealId: number }[]>
  ): Promise<DeadlineDayReport> {
    const report: DeadlineDayReport = { date, assigned: 0, skipped: {} }
    const item = await MenuItem.query({ client: trx })
      .withScopes((scopes) => scopes.current())
      .where('weekly_menu_id', menu.id)
      .where('date', date)
      .where('is_default', true)
      .forUpdate()
      .first()
    if (!item) {
      report.skipped.noDefault = true
      return report
    }
    const meal = await trx
      .from('meals')
      .where('id', item.mealId)
      .forShare()
      .select('id', 'price_cents', 'allergens', 'is_active', 'deleted_at')
      .first()
    if (!meal || !meal.is_active || meal.deleted_at) {
      report.skipped.mealUnavailable = true
      return report
    }

    const candidateSql = (ids: number[] | null) =>
      trx.rawQuery(
        `SELECT c.id, c.parent_id, c.first_name, c.allergies
         FROM children c
         JOIN users u ON u.id = c.parent_id
        WHERE c.school_id = ? AND c.is_active
          AND u.role = 'parent' AND u.is_active
          AND EXISTS (
            SELECT 1 FROM subscriptions s
             WHERE s.child_id = c.id AND s.status = 'active'
               AND s.start_date <= ?::date AND (s.end_date IS NULL OR s.end_date >= ?::date))
          AND NOT EXISTS (SELECT 1 FROM meal_orders o WHERE o.child_id = c.id AND o.date = ?::date)
          ${ids ? 'AND c.id = ANY(?::int[])' : ''}
        ORDER BY c.id`,
        ids ? [school.id, date, date, date, ids] : [school.id, date, date, date]
      )
    const first = await candidateSql(null)
    const found: Candidate[] = first.rows
    if (!found.length) return report
    // N4: lock the candidates FOR SHARE (id order) so a deactivation can't
    // commit in between, then re-read who still qualifies (active child and
    // parent, covering subscription, no order row).
    await trx
      .from('children')
      .whereIn(
        'id',
        found.map((child) => child.id)
      )
      .orderBy('id')
      .forShare()
      .select('id')
    const recheck = await candidateSql(found.map((child) => child.id))
    let candidates: Candidate[] = recheck.rows
    const safe = candidates.filter(
      (child) => allergyConflicts(meal.allergens ?? [], child.allergies ?? []).length === 0
    )
    if (safe.length < candidates.length) report.skipped.allergy = candidates.length - safe.length
    candidates = safe

    if (item.maxQuantity !== null) {
      const taken = await trx
        .from('meal_order_items as moi')
        .join('meal_orders as mo', 'mo.id', 'moi.meal_order_id')
        .where('moi.menu_item_id', item.id)
        .where('mo.status', 'active')
        .sum('moi.quantity as total')
        .first()
      const remaining = Math.max(0, item.maxQuantity - Number(taken?.total ?? 0))
      if (candidates.length > remaining) {
        report.skipped.soldOut = candidates.length - remaining
        candidates = candidates.slice(0, remaining)
      }
    }
    if (!candidates.length) return report

    const nowIso = this.clock.now().toISO()!
    const inserted = await trx.rawQuery(
      `INSERT INTO meal_orders
         (school_id, child_id, date, weekly_menu_id, status, origin, created_at, updated_at)
       SELECT ?, r.child_id, ?::date, ?, 'active', 'system', ?::timestamptz, ?::timestamptz
         FROM jsonb_to_recordset(?::jsonb) AS r(child_id integer)
       ON CONFLICT (child_id, date) DO NOTHING
       RETURNING id, child_id`,
      [
        school.id,
        date,
        menu.id,
        nowIso,
        nowIso,
        JSON.stringify(candidates.map((child) => ({ child_id: child.id }))),
      ]
    )
    const created: { id: number; child_id: number }[] = inserted.rows
    if (!created.length) return report
    const priceCents = Number(meal.price_cents)
    await trx.rawQuery(
      `INSERT INTO meal_order_items
         (meal_order_id, menu_item_id, meal_id, meal_type, quantity, unit_price_cents, created_at, updated_at)
       SELECT r.id, ?, ?, 'subscription', 1, ?, ?::timestamptz, ?::timestamptz
         FROM jsonb_to_recordset(?::jsonb) AS r(id integer)`,
      [
        item.id,
        item.mealId,
        priceCents,
        nowIso,
        nowIso,
        JSON.stringify(created.map((r) => ({ id: r.id }))),
      ]
    )
    const line = {
      menuItemId: item.id,
      mealId: item.mealId,
      mealType: 'subscription' as const,
      quantity: 1,
      unitPriceCents: priceCents,
    }
    await this.audit.record(
      trx,
      'system',
      created.map((row) => ({
        orderId: Number(row.id),
        childId: Number(row.child_id),
        date,
        action: 'auto_assign' as const,
        before: null,
        after: orderSnapshot('active', null, [line]),
      }))
    )
    const byId = new Map(candidates.map((child) => [child.id, child]))
    for (const row of created) {
      const child = byId.get(Number(row.child_id))
      if (!child) continue
      const list = notices.get(Number(child.parent_id)) ?? []
      list.push({ childName: child.first_name, date, mealId: item.mealId })
      notices.set(Number(child.parent_id), list)
    }
    report.assigned = created.length
    return report
  }
}
