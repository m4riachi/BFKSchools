/**
 * Mirrors the CHECK constraints of the Phase 5 tables (docs/ERD.md).
 */
export const WEEKLY_MENU_STATUSES = ['draft', 'scheduled', 'published', 'closed'] as const
export type WeeklyMenuStatus = (typeof WEEKLY_MENU_STATUSES)[number]

export const NOTIFICATION_TYPES = [
  'menu_published',
  'deadline_reminder',
  'holiday_cancellation',
  'order_changed_by_staff',
  'menu_change',
  'auto_assigned',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

/**
 * Emails a parent may turn off (`users.notification_prefs.<type> = false`,
 * Phase 8 notification center). Everything that changes or cancels a
 * family's orders (holiday cancellation, menu change, order changed by
 * staff) can't be turned off; the school's `email_notifications` switches
 * still apply to every type. In-app notifications are always created.
 */
export const OPT_OUTABLE_EMAILS = ['menu_published', 'deadline_reminder'] as const
export type OptOutableEmail = (typeof OPT_OUTABLE_EMAILS)[number]

export function isOptOutableEmail(type: string): type is OptOutableEmail {
  return (OPT_OUTABLE_EMAILS as readonly string[]).includes(type)
}

/** True when the parent's preferences let this email type through. */
export function emailAllowedByPrefs(
  type: string,
  prefs: Record<string, unknown> | null | undefined
): boolean {
  return !isOptOutableEmail(type) || prefs?.[type] !== false
}

export const OUTBOUND_EMAIL_STATUSES = ['pending', 'sending', 'sent', 'failed'] as const
export type OutboundEmailStatus = (typeof OUTBOUND_EMAIL_STATUSES)[number]
