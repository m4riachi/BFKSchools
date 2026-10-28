/**
 * Access status of a parent account shown in the back-office (derived, never
 * stored — docs/ERD.md §user_tokens):
 * - active: the parent has set a password and the account is enabled;
 * - invited: no password yet, an invitation link is still valid;
 * - expired: no password, the last invitation link expired or was revoked;
 * - not_invited: no password, never invited;
 * - inactive: the account is deactivated (wins over everything else).
 */
export const ACCESS_STATUSES = ['active', 'invited', 'expired', 'not_invited', 'inactive'] as const
export type AccessStatus = (typeof ACCESS_STATUSES)[number]

/** Filters of the parents list. */
export const PARENT_FILTERS = [
  'all',
  'active',
  'invited',
  'not_invited',
  'never_logged_in',
  'inactive',
] as const
export type ParentFilter = (typeof PARENT_FILTERS)[number]
