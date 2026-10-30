import type { Role } from '#enums/roles'

/**
 * Back-office areas a role can open (D42). Users, roles and settings are not
 * here on purpose: they stay admin-only, so nobody can give themselves more.
 */
export const PERMISSIONS = [
  'dashboard',
  'families',
  'meals',
  'menus',
  'holidays',
  'orders',
  'pos',
  'kitchen',
  'statements',
  'reports',
] as const
export type Permission = (typeof PERMISSIONS)[number]

/** Where each area starts, in menu order. */
export const PERMISSION_PATHS: Record<Permission, string> = {
  dashboard: '/admin',
  families: '/admin/parents',
  meals: '/admin/meals',
  menus: '/admin/menus',
  holidays: '/admin/holidays',
  orders: '/admin/orders',
  pos: '/admin/pos',
  kitchen: '/kitchen',
  statements: '/admin/statements',
  reports: '/admin/reports',
}

/** What the built-in roles open. */
export function builtInPermissions(role: Role): readonly Permission[] {
  if (role === 'admin' || role === 'manager') return PERMISSIONS
  if (role === 'kitchen') return ['kitchen']
  return []
}

/** Access level of a custom role: kitchen only, or the back-office. */
export function roleForPermissions(permissions: readonly string[]): Role {
  return permissions.length === 1 && permissions[0] === 'kitchen' ? 'kitchen' : 'manager'
}

/** First part of /admin/… → area. Null (settings, users, roles, anything new): admins only. */
const ADMIN_AREAS: Record<string, Permission> = {
  '': 'dashboard',
  'parents': 'families',
  'imports': 'families',
  'meals': 'meals',
  'menus': 'menus',
  'menu-templates': 'menus',
  'holidays': 'holidays',
  'orders': 'orders',
  'pos': 'pos',
  'statements': 'statements',
  'reports': 'reports',
}

export function areaOfRoute(pattern: string | undefined): Permission | null {
  const [area, section = ''] = (pattern ?? '').replace(/^\//, '').split('/')
  if (area === 'kitchen') return 'kitchen'
  if (area !== 'admin') return null
  return Object.hasOwn(ADMIN_AREAS, section) ? ADMIN_AREAS[section] : null
}
