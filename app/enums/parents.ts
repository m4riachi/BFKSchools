/**
 * Access status of a parent account shown in the back-office (derived, never
 * stored — docs/ERD.md §user_tokens):
 * - active: the parent has set a password and the account is enabled;
 * - invited: no password yet, an invitation link is still valid;
 * - expired: no password, the last invitation link expired or was revoked;
 * - not_invited: no password, never invited;
 * - inactive: the account is deactivated (wins over everything else);
 * - pending / refused (D59): a QR sign-up waiting for the school, or refused
 *   (both inactive; they win over "inactive").
 */
export const ACCESS_STATUSES = [
  'active',
  'invited',
  'expired',
  'not_invited',
  'inactive',
  'pending',
  'refused',
] as const
export type AccessStatus = (typeof ACCESS_STATUSES)[number]

/** Filters of the parents list. */
export const PARENT_FILTERS = [
  'all',
  'pending',
  'active',
  'invited',
  'not_invited',
  'never_logged_in',
  'inactive',
] as const
export type ParentFilter = (typeof PARENT_FILTERS)[number]

/**
 * D59: a parent who signed up on the QR form (`users.registration_status`).
 * Null for accounts created by staff or the CSV import.
 * - pending: waiting for the school (account and children inactive);
 * - approved: activated by staff (parent + children active);
 * - refused: kept, deactivated (never deleted).
 */
export const REGISTRATION_STATUSES = ['pending', 'approved', 'refused'] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

/** D59: children a parent can declare on the sign-up form. */
export const REGISTRATION_MAX_CHILDREN = 6
