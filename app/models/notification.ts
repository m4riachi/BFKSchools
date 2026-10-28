import { NotificationSchema } from '#database/schema'

/**
 * In-app notice for a user (docs/ERD.md §notifications). Written through
 * NotificationService; listed by the Phase 8 notification center.
 */
export default class Notification extends NotificationSchema {}
