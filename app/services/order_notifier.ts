import { inject } from '@adonisjs/core'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type School from '#models/school'
import NotificationService from '#services/notification_service'
import OutboxService, { type OutboxEmailInput } from '#services/outbox_service'
import SchoolSettingsService from '#services/school_settings_service'
import type { NotificationType } from '#enums/menus'
import type { EmailNotificationSettings } from '#types/school_settings'
import { isAppLocale } from '#enums/locales'

export type NoticeRecipient = {
  id: number
  email: string
  locale: string
  isActive: boolean
  notificationPrefs: Record<string, unknown> | null
}

export type Notice = {
  recipient: NoticeRecipient
  /** In-app notification data (ids + i18n params only). */
  data: Record<string, unknown>
  /** Outbox payload (ids only; the mail class reloads the rest). */
  payload: Record<string, unknown>
  /** Unique per user for the notification; per email globally (suffixed with the user id). */
  dedupeKey: string
}

/**
 * Notification types that change or cancel a family's orders: the parent
 * cannot opt out of their emails (docs/ERD.md §users.notification_prefs);
 * the school's `email_notifications` switches still apply.
 */
const NOT_OPT_OUTABLE = new Set<NotificationType>([
  'holiday_cancellation',
  'menu_change',
  'order_changed_by_staff',
])

/**
 * Tells parents what happened to their orders (Phase 6): an in-app
 * notification (always) and an outbox email when the school's settings —
 * and, for reminders, the parent's preferences — allow it. Always called
 * inside the transaction that made the change; dedupe keys make re-runs
 * harmless.
 */
@inject()
export default class OrderNotifier {
  constructor(
    protected notifications: NotificationService,
    protected outbox: OutboxService,
    protected settings: SchoolSettingsService
  ) {}

  emailsOn(school: Pick<School, 'settings'>, type: keyof EmailNotificationSettings) {
    const email = this.settings.get(school).email_notifications
    return email.enabled && email[type]
  }

  async send(
    client: QueryClientContract,
    school: Pick<School, 'settings'>,
    type: Exclude<NotificationType, 'menu_published' | 'auto_assigned'> | 'auto_assigned',
    notices: Notice[],
    options: { email?: boolean } = {}
  ) {
    const active = notices.filter((notice) => notice.recipient.isActive)
    if (!active.length) return { notifications: 0, emails: 0 }
    const notifications = await this.notifications.notifyMany(
      type,
      active.map((notice) => ({
        userId: notice.recipient.id,
        data: notice.data,
        dedupeKey: notice.dedupeKey,
      })),
      client
    )

    const emailKey = type === 'auto_assigned' ? null : type
    if (!emailKey || options.email === false || !this.emailsOn(school, emailKey)) {
      return { notifications, emails: 0 }
    }
    const inputs: OutboxEmailInput[] = active
      .filter(
        (notice) =>
          NOT_OPT_OUTABLE.has(type) || notice.recipient.notificationPrefs?.[type] !== false
      )
      .map((notice) => ({
        userId: notice.recipient.id,
        toEmail: notice.recipient.email,
        locale: isAppLocale(notice.recipient.locale) ? notice.recipient.locale : 'fr',
        mailKey: type,
        payload: notice.payload,
        dedupeKey: `${notice.dedupeKey}:user:${notice.recipient.id}`,
      }))
    const result = await this.outbox.enqueueMany(inputs, client)
    return { notifications, emails: result.created }
  }

  /** Active parents by id (for notices built from order rows). */
  async recipients(
    client: QueryClientContract,
    ids: number[]
  ): Promise<Map<number, NoticeRecipient>> {
    const unique = [...new Set(ids)]
    const map = new Map<number, NoticeRecipient>()
    for (let start = 0; start < unique.length; start += 500) {
      const rows = await client
        .from('users')
        .whereIn('id', unique.slice(start, start + 500))
        .where('role', 'parent')
        .select('id', 'email', 'locale', 'is_active', 'notification_prefs')
      for (const row of rows) {
        map.set(Number(row.id), {
          id: Number(row.id),
          email: String(row.email),
          locale: String(row.locale),
          isActive: Boolean(row.is_active),
          notificationPrefs: row.notification_prefs ?? null,
        })
      }
    }
    return map
  }
}
