import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import School from '#models/school'
import type User from '#models/user'
import MenuItem from '#models/menu_item'
import WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import MenuCalendar, { type MenuIssue } from '#services/menu_calendar'
import NotificationService from '#services/notification_service'
import OutboxService from '#services/outbox_service'
import SchoolSettingsService from '#services/school_settings_service'
import { isAppLocale } from '#enums/locales'
import { emailAllowedByPrefs } from '#enums/menus'

/** Recipients loaded per query (keyset pagination). */
const RECIPIENT_BATCH = 500

/**
 * Issues that stop the **scheduled job** from publishing (nothing sensible
 * to publish). Other issues (a meal deactivated or a day that became a
 * holiday after scheduling) are logged but don't block the automatic launch:
 * holiday days are locked for ordering anyway (OrderWindowService, Phase 6).
 * A manual "publish now" refuses every issue (the admin can fix it).
 */
const BLOCKING_FOR_JOB = new Set<MenuIssue['code']>([
  'missing_times',
  'deadline_before_publish',
  'no_open_day',
])

export type PublishOutcome =
  | {
      published: true
      menuId: number
      recipients: number
      notifications: number
      emails: number
      invalidEmails: number
    }
  | {
      published: false
      menuId: number
      reason:
        'not_found' | 'not_scheduled' | 'not_due' | 'not_ready' | 'week_over' | 'deadline_passed'
      issues?: MenuIssue[]
      /** deadline_passed: first time the job met this menu (log it once). */
      firstWarning?: boolean
    }

export type Recipient = {
  id: number
  email: string
  locale: string
  notification_prefs: Record<string, unknown> | null
}

/**
 * Publication of a weekly menu (brief §5.4 "automatic launch"): status
 * `scheduled` → `published`, `published_at` set, then one in-app
 * notification and (when emails are on) one outbox email per active parent
 * of the school with at least one active child.
 *
 * Idempotent: the menu row is locked and must still be `scheduled`; the
 * notifications (`menu_published:<menuId>` per user) and the emails
 * (`menu_published:<menuId>:user:<id>`) carry dedupe keys; everything is
 * written in one transaction. Emails are only queued here — `mail:dispatch`
 * sends them in capped batches and logs failures.
 */
@inject()
export default class MenuPublicationService {
  constructor(
    protected clock: Clock,
    protected calendar: MenuCalendar,
    protected settings: SchoolSettingsService,
    protected notifications: NotificationService,
    protected outbox: OutboxService
  ) {}

  /**
   * Publishes one menu. `origin = 'job'` only publishes when `publish_at`
   * has passed; `'manual'` ("publish now") publishes immediately but refuses
   * any readiness issue.
   */
  async publish(
    menuId: number,
    options: { origin: 'job' | 'manual'; actor?: User | null }
  ): Promise<PublishOutcome> {
    return db.transaction(async (trx) => {
      const menu = await WeeklyMenu.query({ client: trx }).where('id', menuId).forUpdate().first()
      if (!menu) return { published: false, menuId, reason: 'not_found' }
      if (menu.status !== 'scheduled') return { published: false, menuId, reason: 'not_scheduled' }

      const now = this.clock.now()
      if (options.origin === 'job' && (!menu.publishAt || menu.publishAt > now)) {
        return { published: false, menuId, reason: 'not_due' }
      }

      const school = await School.findOrFail(menu.schoolId, { client: trx })
      // Never announce a week that is already over (job or manual). The job
      // skips such menus up front; menus:close-past moves them back to draft.
      if (this.calendar.weekEndsAt(school, menu.weekStart) <= now) {
        return { published: false, menuId, reason: 'week_over' }
      }
      // D19: never publish once the order deadline has passed (parents would
      // get no ordering window). "Publish now" is refused (staff set new
      // times); the job leaves the menu scheduled and warns once.
      if (menu.orderDeadlineAt && menu.orderDeadlineAt <= now) {
        let firstWarning = false
        if (options.origin === 'job' && !menu.latePublishWarnedAt) {
          menu.useTransaction(trx)
          menu.latePublishWarnedAt = now
          await menu.save()
          firstWarning = true
        }
        return { published: false, menuId, reason: 'deadline_passed', firstWarning }
      }

      const issues = await this.issues(trx, school, menu)
      const blocking =
        options.origin === 'manual'
          ? issues
          : issues.filter((issue) => BLOCKING_FOR_JOB.has(issue.code))
      if (blocking.length) return { published: false, menuId, reason: 'not_ready', issues }
      if (issues.length) {
        logger.warn({ menuId, issues }, 'menus: publishing a menu with readiness warnings')
      }

      menu.useTransaction(trx)
      menu.status = 'published'
      menu.publishedAt = now
      if (options.actor) menu.updatedBy = options.actor.id
      await menu.save()

      const counts = await this.notifyParents(trx, school, menu)
      return { published: true, menuId, ...counts }
    })
  }

  async issues(client: QueryClientContract, school: School, menu: WeeklyMenu) {
    const days = await this.calendar.days(school, menu.weekStart, client)
    const items = await MenuItem.query({ client })
      .withScopes((scopes) => scopes.current())
      .where('weekly_menu_id', menu.id)
      .preload('meal')
    return this.calendar.readiness(school, menu, days, items)
  }

  /**
   * Active parents of the school with at least one active child, by id
   * (keyset pagination so large schools are read in batches).
   */
  async *recipients(client: QueryClientContract, schoolId: number): AsyncGenerator<Recipient[]> {
    let lastId = 0
    for (;;) {
      const rows = (await client
        .from('users')
        .where('role', 'parent')
        .where('is_active', true)
        .where('school_id', schoolId)
        .where('id', '>', lastId)
        .whereExists((sub) => {
          sub
            .from('children')
            .whereColumn('children.parent_id', 'users.id')
            .where('children.is_active', true)
            .where('children.school_id', schoolId)
        })
        .orderBy('id')
        .limit(RECIPIENT_BATCH)
        .select('id', 'email', 'locale', 'notification_prefs')) as Recipient[]
      if (!rows.length) return
      yield rows
      lastId = rows[rows.length - 1].id
    }
  }

  /** Number of parents a publication would reach (shown in the builder). */
  async countRecipients(schoolId: number): Promise<number> {
    let total = 0
    for await (const batch of this.recipients(db.connection(), schoolId)) total += batch.length
    return total
  }

  protected async notifyParents(trx: TransactionClientContract, school: School, menu: WeeklyMenu) {
    const emailSettings = this.settings.get(school).email_notifications
    const sendEmails = emailSettings.enabled && emailSettings.menu_published
    const data = { weeklyMenuId: menu.id, weekStart: menu.weekStart }
    const counts = { recipients: 0, notifications: 0, emails: 0, invalidEmails: 0 }

    for await (const batch of this.recipients(trx, school.id)) {
      counts.recipients += batch.length
      counts.notifications += await this.notifications.notifyMany(
        'menu_published',
        batch.map((user) => ({ userId: user.id, data, dedupeKey: `menu_published:${menu.id}` })),
        trx
      )
      if (!sendEmails) continue
      // Per-parent opt-out (notification center): notification_prefs.menu_published = false.
      const optedIn = batch.filter((user) =>
        emailAllowedByPrefs('menu_published', user.notification_prefs)
      )
      const result = await this.outbox.enqueueMany(
        optedIn.map((user) => ({
          userId: user.id,
          toEmail: user.email,
          locale: isAppLocale(user.locale) ? user.locale : 'fr',
          mailKey: 'menu_published',
          payload: { weeklyMenuId: menu.id },
          dedupeKey: `menu_published:${menu.id}:user:${user.id}`,
        })),
        trx
      )
      counts.emails += result.created
      counts.invalidEmails += result.invalid
    }
    return counts
  }
}
