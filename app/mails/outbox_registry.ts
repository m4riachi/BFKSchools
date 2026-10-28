import type { BaseMail } from '@adonisjs/mail'
import User from '#models/user'
import School from '#models/school'
import WeeklyMenu from '#models/weekly_menu'
import type OutboundEmail from '#models/outbound_email'
import MenuPublishedMail from '#mails/menu_published_mail'
import OrderNoticeMail, { type OrderNoticeContent } from '#mails/order_notice_mail'
import MenuItem from '#models/menu_item'
import OrderAuditLog from '#models/order_audit_log'
import Meal from '#models/meal'
import db from '@adonisjs/lucid/services/db'
import i18nManager from '@adonisjs/i18n/services/main'
import app from '@adonisjs/core/services/app'
import Clock from '#services/clock'
import { isSafeEmail } from '#validators/rules'
import { isAppLocale, type AppLocale } from '#enums/locales'
import { mealName } from '#support/meal_display'
import { dayLabel, instantLabel, schoolZone, weekRangeLabel } from '#support/menu_display'

/**
 * Mail classes that can be queued in the outbox, by `mail_key`. A builder
 * reloads what it needs from the row's payload (ids only) and returns the
 * mail, or `{ skip }` when it must not be sent any more (recipient
 * deactivated, menu gone, …) — skipped rows end as `failed` with the reason.
 *
 * Phase 6 added deadline_reminder, holiday_cancellation, menu_change and
 * order_changed_by_staff (OrderNoticeMail). Every builder that reads orders
 * re-checks they belong to the recipient's children (a payload never
 * reveals another family's data).
 */
type Built = { mail: BaseMail } | { skip: string }
type Recipient = Pick<User, 'id' | 'email' | 'fullName' | 'isActive'>
type Builder = (row: OutboundEmail, recipient: Recipient) => Promise<Built>

function positiveId(value: unknown): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null
}

function positiveIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, 200)
    .map(positiveId)
    .filter((id): id is number => id !== null)
}

function localeOf(row: OutboundEmail): AppLocale {
  return isAppLocale(row.locale) ? row.locale : 'fr'
}

/** Shared parts of an order notice in the row's language. */
function notice(
  row: OutboundEmail,
  recipient: Recipient,
  key: string,
  values: Record<string, string | number>,
  paragraphs: string[]
): OrderNoticeContent {
  const i18n = i18nManager.locale(localeOf(row))
  return {
    subject: i18n.t(`emails.${key}.subject`, values),
    title: i18n.t(`emails.${key}.title`, values),
    greeting: i18n.t('emails.greeting', { name: recipient.fullName }),
    paragraphs,
    action: i18n.t(`emails.${key}.action`),
    fallback: i18n.t('emails.link_fallback'),
    signature: i18n.t('emails.signature'),
    footer: i18n.t('emails.order_footer'),
  }
}

/** Orders among `ids` that belong to the recipient's children, with the child's first name. */
async function ordersOfRecipient(recipientId: number, ids: number[]) {
  if (!ids.length) return []
  const rows = await db
    .from('meal_orders as mo')
    .join('children as c', 'c.id', 'mo.child_id')
    .whereIn('mo.id', ids)
    .where('c.parent_id', recipientId)
    .orderBy('mo.date')
    .orderBy('c.first_name')
    .select('mo.id', 'mo.date', 'mo.status', 'mo.cancel_reason', 'c.first_name')
  return rows.map((row) => ({
    id: Number(row.id),
    date: String(row.date),
    status: String(row.status),
    cancelReason: row.cancel_reason as string | null,
    childName: String(row.first_name),
  }))
}

export const OUTBOX_MAILS: Record<string, Builder> = {
  async menu_published(row, recipient) {
    const menuId = positiveId(row.payload.weeklyMenuId)
    const menu = menuId ? await WeeklyMenu.find(menuId) : null
    if (!menu || !['published', 'closed'].includes(menu.status)) return { skip: 'menu_unavailable' }
    const school = await School.findOrFail(menu.schoolId)
    return { mail: new MenuPublishedMail(recipient, row.locale, menu, school) }
  },

  async deadline_reminder(row, recipient) {
    const menuId = positiveId(row.payload.weeklyMenuId)
    const menu = menuId ? await WeeklyMenu.find(menuId) : null
    if (!menu || menu.status !== 'published' || !menu.orderDeadlineAt) {
      return { skip: 'menu_unavailable' }
    }
    // Sent late (outbox backlog): a reminder after the deadline is noise.
    const clock = await app.container.make(Clock)
    if (menu.orderDeadlineAt <= clock.now()) return { skip: 'deadline_passed' }
    const school = await School.findOrFail(menu.schoolId)
    const locale = localeOf(row)
    const i18n = i18nManager.locale(locale)
    const week = weekRangeLabel(menu.weekStart, school.schoolDays, locale)
    const deadline = instantLabel(menu.orderDeadlineAt, locale, schoolZone(school))
    return {
      mail: new OrderNoticeMail(
        recipient,
        locale,
        notice(row, recipient, 'deadline_reminder', { week }, [
          i18n.t('emails.deadline_reminder.intro', { week }),
          i18n.t('emails.deadline_reminder.deadline', { date: deadline }),
          i18n.t('emails.deadline_reminder.default_note'),
        ])
      ),
    }
  },

  async holiday_cancellation(row, recipient) {
    const owned = await ordersOfRecipient(recipient.id, positiveIds(row.payload.orderIds))
    const orders = owned.filter(
      (order) => order.status === 'cancelled' && order.cancelReason === 'holiday'
    )
    if (!orders.length) return { skip: 'orders_unavailable' }
    const locale = localeOf(row)
    const i18n = i18nManager.locale(locale)
    return {
      mail: new OrderNoticeMail(
        recipient,
        locale,
        notice(row, recipient, 'holiday_cancellation', { count: orders.length }, [
          i18n.t('emails.holiday_cancellation.intro', { count: orders.length }),
          ...orders.map((order) =>
            i18n.t('emails.order_line', {
              child: order.childName,
              date: dayLabel(order.date, locale),
            })
          ),
          i18n.t('emails.holiday_cancellation.not_charged'),
        ])
      ),
    }
  },

  async menu_change(row, recipient) {
    const itemId = positiveId(row.payload.menuItemId)
    const item = itemId ? await MenuItem.query().where('id', itemId).preload('meal').first() : null
    if (!item) return { skip: 'item_unavailable' }
    const locale = localeOf(row)
    const i18n = i18nManager.locale(locale)
    const date = dayLabel(item.date, locale)
    const meal = mealName(item.meal, locale)
    if (row.payload.kind === 'default_changed') {
      return {
        mail: new OrderNoticeMail(
          recipient,
          locale,
          notice(row, recipient, 'menu_change', { date }, [
            i18n.t('emails.menu_change.default_changed', { date, meal }),
            i18n.t('emails.menu_change.default_note'),
          ])
        ),
      }
    }
    const orders = await ordersOfRecipient(recipient.id, positiveIds(row.payload.orderIds))
    if (!orders.length) return { skip: 'orders_unavailable' }
    const targetId = positiveId(row.payload.targetItemId)
    const target = targetId ? await MenuItem.find(targetId) : null
    const targetMeal = target ? await Meal.find(target.mealId) : null
    const children = [...new Set(orders.map((order) => order.childName))].join(', ')
    const paragraphs = [i18n.t('emails.menu_change.item_removed', { date, meal })]
    paragraphs.push(
      targetMeal
        ? i18n.t('emails.menu_change.switched', { meal: mealName(targetMeal, locale), children })
        : i18n.t('emails.menu_change.cancelled', { children })
    )
    paragraphs.push(i18n.t('emails.menu_change.check'))
    return {
      mail: new OrderNoticeMail(
        recipient,
        locale,
        notice(row, recipient, 'menu_change', { date }, paragraphs)
      ),
    }
  },

  async order_changed_by_staff(row, recipient) {
    const auditId = positiveId(row.payload.auditId)
    const audit = auditId ? await OrderAuditLog.find(auditId) : null
    if (!audit) return { skip: 'audit_unavailable' }
    const [order] = await ordersOfRecipient(recipient.id, [audit.mealOrderId])
    if (!order) return { skip: 'orders_unavailable' }
    const locale = localeOf(row)
    const i18n = i18nManager.locale(locale)
    const date = dayLabel(audit.date, locale)
    const paragraphs = [
      i18n.t('emails.order_changed_by_staff.intro', { child: order.childName, date }),
    ]
    const after = audit.after
    if (!after || after.status === 'cancelled') {
      paragraphs.push(i18n.t('emails.order_changed_by_staff.cancelled'))
    } else {
      const meals = await Meal.query().whereIn(
        'id',
        after.items.map((item) => item.mealId)
      )
      const names = new Map(meals.map((meal) => [meal.id, mealName(meal, locale)]))
      for (const item of after.items) {
        paragraphs.push(
          i18n.t('emails.order_changed_by_staff.line', {
            meal: names.get(item.mealId) ?? '',
            qty: item.qty,
          })
        )
      }
    }
    return {
      mail: new OrderNoticeMail(
        recipient,
        locale,
        notice(
          row,
          recipient,
          'order_changed_by_staff',
          { child: order.childName, date },
          paragraphs
        )
      ),
    }
  },
}

/**
 * Builds the mail of an outbox row. The recipient is the user's **current**
 * address when the row belongs to a user (they may have changed it since the
 * row was queued); inactive users are skipped.
 */
export async function buildOutboxMail(row: OutboundEmail): Promise<Built> {
  const builder = Object.hasOwn(OUTBOX_MAILS, row.mailKey) ? OUTBOX_MAILS[row.mailKey] : undefined
  if (!builder) return { skip: 'unknown_mail_key' }

  let recipient: Recipient
  if (row.userId !== null) {
    const user = await User.find(row.userId)
    if (!user || !user.isActive) return { skip: 'recipient_inactive' }
    recipient = user
  } else {
    recipient = { id: 0, email: row.toEmail, fullName: '', isActive: true }
  }
  if (!isSafeEmail(recipient.email)) return { skip: 'invalid_recipient' }
  return builder(row, recipient)
}
