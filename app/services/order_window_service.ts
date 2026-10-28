import type { DateTime } from 'luxon'
import type { SchoolSettings } from '#types/school_settings'
import type { WeeklyMenuStatus } from '#enums/menus'
import type { MealType } from '#enums/meals'
import type { SelectionError, WindowReason } from '#enums/orders'
import { addDays, atLocalTime, type IsoDate } from '#support/dates'

/**
 * THE ordering rules (brief §5.6, golden rule 3). Every decision about
 * whether a day can be ordered or changed, and whether a selection is
 * acceptable, is taken here — on the server. Controllers, jobs and the UI
 * only load facts, call these functions and display their answer.
 *
 * Everything in this file is **pure**: no database, no clock. Callers pass
 * "now" (from Clock) and the facts they loaded (under locks when writing).
 * Instants are compared with Luxon in the school's IANA zone
 * (Africa/Casablanca) — never with a fixed offset.
 */

export type WindowSettings = Pick<
  SchoolSettings,
  'allow_parent_edits' | 'edit_mode' | 'edit_cutoff_days_before' | 'edit_cutoff_time'
>

export type WindowInput = {
  /** Business day ('YYYY-MM-DD'). */
  date: IsoDate
  now: DateTime
  /** IANA zone of the school. */
  zone: string
  /** Menu of the date's week (null when there is none). */
  menu: { status: WeeklyMenuStatus; orderDeadlineAt: DateTime | null } | null
  /** The day has at least one (not removed) menu item. */
  hasMeals: boolean
  isHoliday: boolean
  /** School weekday inside the school year (same rule as MenuCalendar). */
  isSchoolDay: boolean
  /**
   * The day's order was cancelled by staff (`staff`) or for an inactive
   * child (`child_inactive`): only staff can re-open it (D24).
   */
  staffCancelled?: boolean
  settings: WindowSettings
  child: { isActive: boolean }
  parent: { isActive: boolean }
}

export type WindowDecision = {
  allowed: boolean
  reason: WindowReason | null
  /** Kitchen lock of the day: (date − edit_cutoff_days_before) at edit_cutoff_time. */
  cutoffAt: DateTime
  /** The week's order deadline has passed. */
  deadlinePassed: boolean
  /** Last instant a parent can still change the day (when allowed). */
  editableUntil: DateTime | null
}

/**
 * The last instant a day can still be changed **after the deadline**, in
 * the school zone (wall-clock time):
 * - `until_cutoff`: (date − edit_cutoff_days_before) at edit_cutoff_time;
 * - `same_day_only`: the day itself at edit_cutoff_time
 *   (edit_cutoff_days_before does not apply in that mode — brief §5.6).
 */
export function cutoffFor(date: IsoDate, settings: WindowSettings, zone: string): DateTime {
  const day =
    settings.edit_mode === 'same_day_only' ? date : addDays(date, -settings.edit_cutoff_days_before)
  return atLocalTime(day, settings.edit_cutoff_time, zone)
}

function latest(a: DateTime, b: DateTime) {
  return a >= b ? a : b
}

/**
 * Can the parent create / change / cancel the order of `date` right now?
 * Brief §5.6 is the source of truth; rules, in this order:
 * 1. locked when the day is past, not a school day (weekday or school
 *    year), a holiday, not on a published menu (or the published day has
 *    no meals), the child or parent is inactive, or staff cancelled the
 *    day (D24);
 * 2. before the week's `order_deadline_at`: free (create, change, cancel);
 * 3. after it: only with `allow_parent_edits`, then
 *    - `until_cutoff` → until the day's cutoff
 *      ((date − edit_cutoff_days_before) at edit_cutoff_time), else AFTER_CUTOFF;
 *    - `same_day_only` → only today, before today's edit_cutoff_time, else
 *      SAME_DAY_ONLY.
 * Creating an order for an empty day after the deadline follows the same
 * rules as a change. Instants are compared in the school's IANA zone.
 */
export function evaluate(input: WindowInput): WindowDecision {
  const { date, now, zone, menu, settings } = input
  const today = now.setZone(zone).toISODate()!
  const cutoffAt = cutoffFor(date, settings, zone)
  const deadline = menu?.orderDeadlineAt ?? null
  const deadlinePassed = deadline !== null && now >= deadline
  const refuse = (reason: WindowReason): WindowDecision => ({
    allowed: false,
    reason,
    cutoffAt,
    deadlinePassed,
    editableUntil: null,
  })

  // 1. Locked days
  if (date < today) return refuse('PAST_DAY')
  if (!input.isSchoolDay) return refuse('NOT_SCHOOL_DAY')
  if (input.isHoliday) return refuse('HOLIDAY')
  if (!menu || menu.status !== 'published' || !deadline) return refuse('NOT_PUBLISHED')
  if (!input.hasMeals) return refuse('NO_MEALS')
  if (!input.child.isActive || !input.parent.isActive) return refuse('INACTIVE')
  if (input.staffCancelled) return refuse('CANCELLED_BY_STAFF')

  // 2. Before the deadline: free. Announced end of the window: the later of
  // the deadline and the cutoff when changes stay open until the cutoff,
  // otherwise the deadline (a same-day window may reopen on the day itself).
  if (!deadlinePassed) {
    const until =
      settings.allow_parent_edits && settings.edit_mode === 'until_cutoff'
        ? latest(deadline, cutoffAt)
        : deadline
    return { allowed: true, reason: null, cutoffAt, deadlinePassed, editableUntil: until }
  }

  // 3. After the deadline
  if (!settings.allow_parent_edits) return refuse('EDITS_DISABLED')
  if (settings.edit_mode === 'same_day_only') {
    if (date !== today || now >= cutoffAt) return refuse('SAME_DAY_ONLY')
  } else if (now >= cutoffAt) {
    return refuse('AFTER_CUTOFF')
  }
  return { allowed: true, reason: null, cutoffAt, deadlinePassed, editableUntil: cutoffAt }
}

/**
 * Reasons staff (admin/manager) may override, with a mandatory reason that
 * is audited. Structural locks (not a school day, holiday, nothing
 * published, no meals) can't be overridden: there is nothing to order. An
 * inactive child or parent can only be cancelled for, not ordered for.
 * A day cancelled by staff (D24) is re-opened by staff.
 */
export function staffCanOverride(reason: WindowReason, action: 'save' | 'cancel'): boolean {
  if (
    ['PAST_DAY', 'AFTER_CUTOFF', 'EDITS_DISABLED', 'SAME_DAY_ONLY', 'CANCELLED_BY_STAFF'].includes(
      reason
    )
  ) {
    return true
  }
  return action === 'cancel' && reason === 'INACTIVE'
}

/**
 * D23: staff change orders only for dates of the current calendar month
 * (school time zone) or later; older dates are refused even for admins.
 */
export function staffMayChangeDate(date: IsoDate, today: IsoDate): boolean {
  return date >= `${today.slice(0, 7)}-01`
}

/* ------------------------------------------------------------------------ */
/* Selection rules                                                          */
/* ------------------------------------------------------------------------ */

/** A menu item of the day, with the facts the rules need. */
export type DayOption = {
  menuItemId: number
  mealId: number
  mealType: MealType
  isDefault: boolean
  maxQuantity: number | null
  /** Meal active and not deleted. */
  mealAvailable: boolean
  allergens: readonly string[]
  priceCents: number
  /** Portions of this item in the other active orders (for max_quantity). */
  orderedElsewhere: number
}

export type SelectionRequest = {
  subscriptionMealId: number | null
  supplements: { mealId: number; qty: number }[]
  confirmAllergy?: boolean
}

export type SelectionRules = {
  allergyRule: SchoolSettings['allergy_rule']
  supplementMaxQuantity: number
  /** D2: subscription meals need a covering active subscription. */
  subscriptionRequired: boolean
}

export type SelectionInput = {
  request: SelectionRequest
  /** Current (not removed) items of the day. */
  options: DayOption[]
  /** Lines of the child's **active** order of that day (empty when none / cancelled). */
  existing: { menuItemId: number; qty: number }[]
  childAllergies: readonly string[]
  hasSubscription: boolean
  rules: SelectionRules
}

export type SelectedLine = { option: DayOption; qty: number }

export type SelectionResult =
  | { ok: true; lines: SelectedLine[] }
  | { ok: false; error: SelectionError; mealId?: number; values?: Record<string, number> }

/** Allergens of a meal that the child is allergic to (in the meal's order). */
export function allergyConflicts(
  allergens: readonly string[],
  childAllergies: readonly string[]
): string[] {
  return allergens.filter((code) => childAllergies.includes(code))
}

/** Portions still available for this child (null = unlimited). */
export function remainingFor(option: DayOption, existingQty = 0): number | null {
  if (option.maxQuantity === null) return null
  return Math.max(0, option.maxQuantity - option.orderedElsewhere - existingQty)
}

/**
 * Validates a day selection against the day's menu and the child (rules of
 * `OrderService.saveDay`). Checked only for lines that are **new or
 * increased** compared with the existing active order: an unchanged line
 * stays valid even if the meal was deactivated or the allergy added since
 * (the kitchen allergy sheet still shows it).
 */
export function checkSelection(input: SelectionInput): SelectionResult {
  const { request, options, rules } = input
  const lines: SelectedLine[] = []
  const existingQty = new Map(input.existing.map((line) => [line.menuItemId, line.qty]))
  const byMeal = new Map(options.map((option) => [option.mealId, option]))

  if (request.subscriptionMealId !== null) {
    const option = byMeal.get(request.subscriptionMealId)
    if (!option) return { ok: false, error: 'MEAL_NOT_ON_MENU', mealId: request.subscriptionMealId }
    if (option.mealType !== 'subscription') {
      return { ok: false, error: 'WRONG_MEAL_TYPE', mealId: option.mealId }
    }
    lines.push({ option, qty: 1 })
  }

  const seen = new Set<number>()
  for (const supplement of request.supplements) {
    if (seen.has(supplement.mealId)) {
      return { ok: false, error: 'DUPLICATE_SUPPLEMENT', mealId: supplement.mealId }
    }
    seen.add(supplement.mealId)
    const option = byMeal.get(supplement.mealId)
    if (!option) return { ok: false, error: 'MEAL_NOT_ON_MENU', mealId: supplement.mealId }
    if (option.mealType === 'subscription') {
      // A second main meal sent as a "supplement".
      return { ok: false, error: 'TWO_SUBSCRIPTION_MEALS', mealId: option.mealId }
    }
    if (
      !Number.isSafeInteger(supplement.qty) ||
      supplement.qty < 1 ||
      supplement.qty > rules.supplementMaxQuantity
    ) {
      return {
        ok: false,
        error: 'SUPPLEMENT_QUANTITY',
        mealId: option.mealId,
        values: { max: rules.supplementMaxQuantity },
      }
    }
    lines.push({ option, qty: supplement.qty })
  }

  if (lines.filter((line) => line.option.mealType === 'subscription').length > 1) {
    return { ok: false, error: 'TWO_SUBSCRIPTION_MEALS' }
  }
  if (lines.length === 0) return { ok: false, error: 'EMPTY_SELECTION' }

  for (const line of lines) {
    const before = existingQty.get(line.option.menuItemId) ?? 0
    if (line.qty <= before) continue // unchanged or decreased: always kept

    if (!line.option.mealAvailable) {
      return { ok: false, error: 'MEAL_UNAVAILABLE', mealId: line.option.mealId }
    }
    if (
      line.option.mealType === 'subscription' &&
      rules.subscriptionRequired &&
      !input.hasSubscription
    ) {
      return { ok: false, error: 'NO_SUBSCRIPTION', mealId: line.option.mealId }
    }
    if (
      line.option.maxQuantity !== null &&
      line.option.orderedElsewhere + line.qty > line.option.maxQuantity
    ) {
      return {
        ok: false,
        error: 'SOLD_OUT',
        mealId: line.option.mealId,
        values: {
          remaining: Math.max(0, line.option.maxQuantity - line.option.orderedElsewhere),
        },
      }
    }
    if (allergyConflicts(line.option.allergens, input.childAllergies).length) {
      if (rules.allergyRule === 'block') {
        return { ok: false, error: 'ALLERGY_BLOCKED', mealId: line.option.mealId }
      }
      if (!request.confirmAllergy) {
        return { ok: false, error: 'ALLERGY_CONFIRM_REQUIRED', mealId: line.option.mealId }
      }
    }
  }
  return { ok: true, lines }
}

/**
 * What the UI shows next to one option of an open day (it never decides
 * by itself): allergens the child is allergic to, whether choosing it is
 * blocked (D9 block), needs a confirmation (warn_confirm), is sold out or
 * unavailable, and whether a main meal needs a subscription the child lacks.
 */
export function describeOption(
  option: DayOption,
  context: {
    childAllergies: readonly string[]
    hasSubscription: boolean
    rules: SelectionRules
    existingQty: number
  }
) {
  const conflicts = allergyConflicts(option.allergens, context.childAllergies)
  const remaining = remainingFor(option, context.existingQty)
  const noSubscription =
    option.mealType === 'subscription' &&
    context.rules.subscriptionRequired &&
    !context.hasSubscription
  // How many portions the child may hold in total (current + remaining).
  const typeMax = option.mealType === 'subscription' ? 1 : context.rules.supplementMaxQuantity
  const maxQty = remaining === null ? typeMax : Math.min(typeMax, context.existingQty + remaining)
  const blockedByAllergy = conflicts.length > 0 && context.rules.allergyRule === 'block'
  return {
    allergyConflicts: conflicts,
    allergyBlocked: blockedByAllergy,
    needsAllergyConfirm: conflicts.length > 0 && context.rules.allergyRule === 'warn_confirm',
    unavailable: !option.mealAvailable,
    noSubscription,
    remaining,
    soldOut: remaining !== null && remaining === 0,
    /** Highest quantity the child can select now (0 = can't add it). */
    maxQty:
      blockedByAllergy || noSubscription || !option.mealAvailable
        ? context.existingQty
        : Math.max(context.existingQty, maxQty),
  }
}

/**
 * Class facade (the name used across the docs): `OrderWindowService.evaluate`,
 * `.checkSelection`, `.describeOption`, `.staffCanOverride`, `.cutoffFor`.
 */
export default class OrderWindowService {
  static evaluate = evaluate
  static checkSelection = checkSelection
  static describeOption = describeOption
  static staffCanOverride = staffCanOverride
  static staffMayChangeDate = staffMayChangeDate
  static cutoffFor = cutoffFor
  static allergyConflicts = allergyConflicts
}
