import type { BaseMail } from '@adonisjs/mail'
import User from '#models/user'
import School from '#models/school'
import WeeklyMenu from '#models/weekly_menu'
import type OutboundEmail from '#models/outbound_email'
import MenuPublishedMail from '#mails/menu_published_mail'
import { isSafeEmail } from '#validators/rules'

/**
 * Mail classes that can be queued in the outbox, by `mail_key`. A builder
 * reloads what it needs from the row's payload (ids only) and returns the
 * mail, or `{ skip }` when it must not be sent any more (recipient
 * deactivated, menu gone, …) — skipped rows end as `failed` with the reason.
 *
 * Later phases add their keys here (deadline_reminder, holiday_cancellation,
 * order_changed_by_staff, menu_change — Phases 6 and 8).
 */
type Built = { mail: BaseMail } | { skip: string }
type Recipient = Pick<User, 'id' | 'email' | 'fullName' | 'isActive'>
type Builder = (row: OutboundEmail, recipient: Recipient) => Promise<Built>

function positiveId(value: unknown): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null
}

export const OUTBOX_MAILS: Record<string, Builder> = {
  async menu_published(row, recipient) {
    const menuId = positiveId(row.payload.weeklyMenuId)
    const menu = menuId ? await WeeklyMenu.find(menuId) : null
    if (!menu || !['published', 'closed'].includes(menu.status)) return { skip: 'menu_unavailable' }
    const school = await School.findOrFail(menu.schoolId)
    return { mail: new MenuPublishedMail(recipient, row.locale, menu, school) }
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
