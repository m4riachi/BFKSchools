import BusinessRuleException from '#exceptions/business_rule_exception'
import type { SelectionError, WindowReason } from '#enums/orders'

export type OrderRule = WindowReason | SelectionError | 'REASON_REQUIRED'

const WINDOW_RULES = new Set<string>([
  'PAST_DAY',
  'HOLIDAY',
  'NOT_PUBLISHED',
  'NO_MEALS',
  'INACTIVE',
  'AFTER_CUTOFF',
  'EDITS_DISABLED',
  'SAME_DAY_ONLY',
])

/**
 * An ordering rule refused the request (OrderWindowService decision).
 * `rule` is the machine code (tests, per-child results of "apply to all my
 * children"); the message is `orders.reasons.<rule>` for a locked day and
 * `orders.errors.<rule>` for a refused selection, shown as an error toast
 * (or under the `reason` field for staff without a reason).
 */
export default class OrderRuleException extends BusinessRuleException {
  constructor(
    readonly rule: OrderRule,
    values: Record<string, string | number> = {},
    readonly mealId: number | null = null
  ) {
    super(OrderRuleException.messageKeyFor(rule), {
      values,
      field: rule === 'REASON_REQUIRED' ? 'reason' : undefined,
    })
  }

  static messageKeyFor(rule: OrderRule) {
    return WINDOW_RULES.has(rule) ? `orders.reasons.${rule}` : `orders.errors.${rule}`
  }
}
