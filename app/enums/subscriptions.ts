/**
 * Mirrors the CHECK constraint on `subscriptions.status`. Only `active`
 * periods cover days (docs/ERD.md §subscriptions); `paused` covers nothing.
 */
export const SUBSCRIPTION_STATUSES = ['active', 'paused', 'ended'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]
