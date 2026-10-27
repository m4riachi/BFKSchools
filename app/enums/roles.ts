/**
 * Mirrors the CHECK constraint on `users.role`.
 */
export const ROLES = ['admin', 'manager', 'kitchen', 'parent'] as const
export type Role = (typeof ROLES)[number]

/** Back-office staff (admin + manager). */
export const STAFF_ROLES: readonly Role[] = ['admin', 'manager']

/** Roles allowed in the kitchen area. */
export const KITCHEN_ROLES: readonly Role[] = ['admin', 'manager', 'kitchen']

/**
 * Where a user lands after login: staff → /admin, kitchen → /kitchen, parents → /.
 */
export function homePathFor(role: Role): string {
  if (role === 'kitchen') return '/kitchen'
  if (role === 'parent') return '/'
  return '/admin'
}
