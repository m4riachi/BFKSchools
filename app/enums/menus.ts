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

export const OUTBOUND_EMAIL_STATUSES = ['pending', 'sending', 'sent', 'failed'] as const
export type OutboundEmailStatus = (typeof OUTBOUND_EMAIL_STATUSES)[number]
