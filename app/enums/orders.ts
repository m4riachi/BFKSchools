/**
 * Mirrors the CHECK constraints of the Phase 6 tables (docs/ERD.md
 * §meal_orders, §meal_order_items, §order_audit_logs).
 */
export const ORDER_STATUSES = ['active', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const CANCEL_REASONS = [
  'absent',
  'holiday',
  'menu_change',
  'staff',
  'child_inactive',
] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]

export const ORDER_ORIGINS = ['parent', 'staff', 'system'] as const
export type OrderOrigin = (typeof ORDER_ORIGINS)[number]

export const AUDIT_ACTOR_ROLES = ['parent', 'admin', 'manager', 'system'] as const
export type AuditActorRole = (typeof AUDIT_ACTOR_ROLES)[number]

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'cancel',
  'reactivate',
  'auto_assign',
  'holiday_cancel',
  'menu_change_switch',
  'menu_change_cancel',
  'staff_override',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** One line of an order as written in the audit log. */
export type OrderSnapshotItem = {
  menuItemId: number
  mealId: number
  mealType: 'subscription' | 'supplement'
  qty: number
  unitPriceCents: number
}

/** `order_audit_logs.before` / `after`. */
export type OrderSnapshot = {
  status: OrderStatus
  cancelReason: CancelReason | null
  items: OrderSnapshotItem[]
}

/**
 * Why a day can't be ordered/changed (OrderWindowService). Translated in the
 * UI under `orders.reasons.<code>`.
 */
export const WINDOW_REASONS = [
  'PAST_DAY',
  'HOLIDAY',
  'NOT_PUBLISHED',
  'NO_MEALS',
  'INACTIVE',
  'AFTER_CUTOFF',
  'EDITS_DISABLED',
  'SAME_DAY_ONLY',
  'NO_SUBSCRIPTION',
] as const
export type WindowReason = (typeof WINDOW_REASONS)[number]

/**
 * Why a selection is refused (OrderWindowService.checkSelection). Translated
 * under `orders.errors.<code>`.
 */
export const SELECTION_ERRORS = [
  'EMPTY_SELECTION',
  'MEAL_NOT_ON_MENU',
  'WRONG_MEAL_TYPE',
  'TWO_SUBSCRIPTION_MEALS',
  'DUPLICATE_SUPPLEMENT',
  'SUPPLEMENT_QUANTITY',
  'MEAL_UNAVAILABLE',
  'SOLD_OUT',
  'NO_SUBSCRIPTION',
  'ALLERGY_BLOCKED',
  'ALLERGY_CONFIRM_REQUIRED',
] as const
export type SelectionError = (typeof SELECTION_ERRORS)[number]
