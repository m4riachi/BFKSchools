import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import i18nManager from '@adonisjs/i18n/services/main'
import Notification from '#models/notification'
import Meal from '#models/meal'
import School from '#models/school'
import type User from '#models/user'
import Clock from '#services/clock'
import { isOptOutableEmail, OPT_OUTABLE_EMAILS, type OptOutableEmail } from '#enums/menus'
import { isIsoDate, weekStart as mondayOf } from '#support/dates'
import { dayLabel, weekRangeLabel } from '#support/menu_display'
import { mealName } from '#support/meal_display'
import { formatMad } from '#support/money'
import { safeTranslate } from '#support/safe_translate'

/**
 * Parent notification center (Phase 8): list, unread count, mark read.
 * Strictly per user — every query is filtered on `user_id = <me>`, so
 * another user's notification id is simply "not found".
 *
 * `notifications.data` holds ids + parameters written by our own services
 * (docs/ERD.md §notifications); the text is rendered here, in the reader's
 * language, with `safeTranslate` (a broken message never becomes a 500)
 * and shown as plain text by Vue (never v-html). Every value read from
 * `data` is type-checked first.
 */
export const NOTIFICATIONS_PER_PAGE = 20
/** Lines (child — day) listed under one notification at most. */
const MAX_LINES = 12

type Data = Record<string, unknown>
type Translator = ReturnType<typeof i18nManager.locale>

export type PresentedNotification = {
  id: number
  type: string
  title: string
  body: string
  lines: string[]
  /** In-app page the notification opens (always a local path). */
  href: string
  createdAt: string
  read: boolean
}

function str(value: unknown, max = 120): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function id(value: unknown): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 && number <= 2147483647 ? number : null
}

function dayList(value: unknown): { childName: string; date: string }[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is Data => typeof entry === 'object' && entry !== null)
    .map((entry) => ({ childName: str(entry.childName, 80), date: str(entry.date, 10) }))
    .filter((entry) => isIsoDate(entry.date))
}

function weekPath(date: unknown): string {
  return isIsoDate(date) ? `/?week=${mondayOf(date)}` : '/'
}

@inject()
export default class NotificationCenterService {
  constructor(protected clock: Clock) {}

  /** Unread count for the header badge (partial index `user_id WHERE read_at IS NULL`). */
  async unreadCount(userId: number): Promise<number> {
    const row = await db
      .from('notifications')
      .where('user_id', userId)
      .whereNull('read_at')
      .count('* as total')
      .first()
    return Number(row?.total ?? 0)
  }

  /** A page of the user's notifications, newest first. */
  async page(user: User, page: number, locale: string) {
    const paginator = await Notification.query()
      .where('user_id', user.id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .paginate(page, NOTIFICATIONS_PER_PAGE)
    const items = await this.present(user, paginator.all(), locale)
    return {
      items,
      meta: {
        total: paginator.total,
        perPage: paginator.perPage,
        currentPage: paginator.currentPage,
        lastPage: paginator.lastPage,
      },
    }
  }

  /** One of the user's notifications, or null (another user's id is "not found"). */
  async find(user: User, notificationId: number) {
    return Notification.query().where('id', notificationId).where('user_id', user.id).first()
  }

  /** Marks one notification read. Returns false when it isn't the user's. */
  async markRead(user: User, notificationId: number): Promise<Notification | null> {
    const notification = await this.find(user, notificationId)
    if (!notification) return null
    if (!notification.readAt) {
      notification.readAt = this.clock.now()
      await notification.save()
    }
    return notification
  }

  /** Marks every unread notification of the user read. Returns how many changed. */
  async markAllRead(user: User): Promise<number> {
    const result = await db.rawQuery(
      'UPDATE notifications SET read_at = ?::timestamptz WHERE user_id = ? AND read_at IS NULL',
      [this.clock.now().toISO()!, user.id]
    )
    return Number(result.rowCount ?? 0)
  }

  /**
   * Email preferences of a parent: only the opt-outable types can change;
   * other keys already stored are kept as they are.
   */
  async updatePreferences(user: User, values: Partial<Record<OptOutableEmail, boolean>>) {
    const prefs: Record<string, boolean> = { ...(user.notificationPrefs ?? {}) }
    for (const key of OPT_OUTABLE_EMAILS) {
      if (typeof values[key] === 'boolean') prefs[key] = values[key]
    }
    user.notificationPrefs = prefs
    await user.save()
    return prefs
  }

  /** Current email preferences (true = emails on). */
  preferences(user: Pick<User, 'notificationPrefs'>): Record<OptOutableEmail, boolean> {
    return Object.fromEntries(
      OPT_OUTABLE_EMAILS.map((key) => [key, user.notificationPrefs?.[key] !== false])
    ) as Record<OptOutableEmail, boolean>
  }

  /** Renders notifications in `locale` (meals and the school loaded once per page). */
  async present(
    user: Pick<User, 'schoolId'>,
    rows: Notification[],
    locale: string
  ): Promise<PresentedNotification[]> {
    const i18n = i18nManager.locale(locale)
    const mealIds = new Set<number>()
    for (const row of rows) {
      const data = (row.data ?? {}) as Data
      for (const key of ['mealId', 'targetMealId']) {
        const mealId = id(data[key])
        if (mealId) mealIds.add(mealId)
      }
      if (Array.isArray(data.days)) {
        for (const day of data.days as Data[]) {
          const mealId = id(day?.mealId)
          if (mealId) mealIds.add(mealId)
        }
      }
    }
    const meals = mealIds.size ? await Meal.query().whereIn('id', [...mealIds].slice(0, 500)) : []
    const mealNames = new Map(meals.map((meal) => [meal.id, mealName(meal, locale)]))
    const school = typeof user.schoolId === 'number' ? await School.find(user.schoolId) : null
    const schoolDays = school?.schoolDays ?? [1, 2, 3, 4, 5]

    return rows.map((row) => {
      const data = (row.data ?? {}) as Data
      const text = this.text(row.type, data, { i18n, locale, mealNames, schoolDays })
      return {
        id: row.id,
        type: row.type,
        ...text,
        createdAt: row.createdAt.toISO()!,
        read: row.readAt !== null && row.readAt !== undefined,
      }
    })
  }

  protected text(
    type: string,
    data: Data,
    context: {
      i18n: Translator
      locale: string
      mealNames: Map<number, string>
      schoolDays: number[]
    }
  ): { title: string; body: string; lines: string[]; href: string } {
    const { i18n, locale, mealNames, schoolDays } = context
    const t = (key: string, values: Record<string, unknown> = {}) =>
      safeTranslate(i18n, `notifications.types.${key}`, values)
    const meal = (value: unknown) => mealNames.get(id(value) ?? 0) ?? '—'
    const week = (value: unknown) =>
      isIsoDate(value) ? weekRangeLabel(mondayOf(value), schoolDays, locale) : ''
    const lines = (days: { childName: string; date: string }[]) =>
      days.slice(0, MAX_LINES).map((day) =>
        safeTranslate(i18n, 'notifications.line', {
          child: day.childName,
          date: dayLabel(day.date, locale),
        })
      )
    const more = (days: unknown[]) =>
      days.length > MAX_LINES
        ? [safeTranslate(i18n, 'notifications.more', { count: days.length - MAX_LINES })]
        : []

    switch (type) {
      case 'menu_published':
        return {
          title: t('menu_published.title'),
          body: t('menu_published.body', { week: week(data.weekStart) }),
          lines: [],
          href: weekPath(data.weekStart),
        }
      case 'deadline_reminder':
        return {
          title: t('deadline_reminder.title'),
          body: t('deadline_reminder.body', { week: week(data.weekStart) }),
          lines: [],
          href: weekPath(data.weekStart),
        }
      case 'auto_assigned': {
        const raw = Array.isArray(data.days) ? (data.days as Data[]) : []
        const days = raw
          .filter((day) => typeof day === 'object' && day !== null && isIsoDate(day.date))
          .slice(0, MAX_LINES)
        return {
          title: t('auto_assigned.title'),
          body: t('auto_assigned.body', { count: raw.length }),
          lines: [
            ...days.map((day) =>
              safeTranslate(i18n, 'notifications.meal_line', {
                child: str(day.childName, 80),
                date: dayLabel(String(day.date), locale),
                meal: meal(day.mealId),
              })
            ),
            ...more(raw),
          ],
          href: weekPath(data.weekStart),
        }
      }
      case 'holiday_cancellation': {
        const days = dayList(data.days)
        return {
          title: t('holiday_cancellation.title'),
          body: t('holiday_cancellation.body', { count: days.length }),
          lines: [...lines(days), ...more(days)],
          href: '/orders/history',
        }
      }
      case 'order_changed_by_staff': {
        if (data.kind === 'child_inactive' || data.kind === 'subscription_ended') {
          const days = dayList(data.days)
          return {
            title: t(`order_bulk_${data.kind}.title`, { count: days.length }),
            body: t(`order_bulk_${data.kind}.body`, { count: days.length }),
            lines: [...lines(days), ...more(days)],
            href: '/orders/history',
          }
        }
        const childId = id(data.childId)
        const date = isIsoDate(data.date) ? data.date : null
        const values = {
          child: str(data.childName, 80),
          date: date ? dayLabel(date, locale) : '',
        }
        return {
          title: t('order_changed_by_staff.title'),
          body:
            data.status === 'cancelled'
              ? t('order_changed_by_staff.body_cancelled', values)
              : t('order_changed_by_staff.body', values),
          lines: [],
          href: childId && date ? `/?child=${childId}&week=${mondayOf(date)}` : '/orders/history',
        }
      }
      case 'menu_change': {
        const date = isIsoDate(data.date) ? data.date : null
        const day = date ? dayLabel(date, locale) : ''
        if (data.kind === 'default_changed') {
          return {
            title: t('menu_change.title', { date: day }),
            body: t('menu_change.default_changed', { date: day, meal: meal(data.mealId) }),
            lines: [],
            href: weekPath(date),
          }
        }
        const children = Array.isArray(data.children)
          ? [...new Set((data.children as unknown[]).map((name) => str(name, 80)))]
              .filter(Boolean)
              .slice(0, MAX_LINES)
              .join(', ')
          : ''
        const extra: string[] = []
        extra.push(
          id(data.targetMealId)
            ? t('menu_change.switched', { meal: meal(data.targetMealId), children })
            : t('menu_change.cancelled', { children })
        )
        const price = Number(data.newUnitPriceCents)
        if (data.priceLowered === true && Number.isSafeInteger(price) && price >= 0) {
          extra.push(
            t('menu_change.price_lowered', {
              price: formatMad(price, locale === 'en' ? 'en' : 'fr'),
            })
          )
        }
        return {
          title: t('menu_change.title', { date: day }),
          body: t('menu_change.item_removed', { date: day, meal: meal(data.mealId) }),
          lines: extra,
          href: weekPath(date),
        }
      }
      default:
        return { title: t('unknown.title'), body: '', lines: [], href: '/' }
    }
  }
}

export { isOptOutableEmail }
