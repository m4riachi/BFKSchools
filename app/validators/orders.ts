import vine from '@vinejs/vine'
import { isoDateRule } from '#validators/rules'
import { ORDER_STATUSES } from '#enums/orders'

/** Database id (int4) sent by the browser. */
const idRule = () => vine.number().withoutDecimals().range([1, 2147483647])

/**
 * A day selection. Only ids and quantities come from the browser: the
 * server resolves meals on the day's menu, prices, the window and every
 * rule (OrderWindowService). Quantities are range-checked again against
 * `supplement_max_quantity` by the rules.
 */
const selectionFields = {
  subscriptionMealId: idRule().nullable().optional(),
  supplements: vine
    .array(
      vine.object({
        mealId: idRule(),
        qty: vine.number().withoutDecimals().range([1, 20]),
      })
    )
    .maxLength(30)
    .optional(),
  confirmAllergy: vine.boolean().optional(),
}

/** Staff reason (mandatory for every staff change; audited). */
const reasonRule = () => vine.string().trim().minLength(3).maxLength(500)

export const daySelectionValidator = vine.create(selectionFields)

export const staffDaySelectionValidator = vine.create({
  ...selectionFields,
  reason: reasonRule(),
})

/** Ordering desk (D39): the audit reason is filled in by the server. */
export const posDaySelectionValidator = vine.create(selectionFields)

export const posQueryValidator = vine.create({
  q: vine.string().trim().maxLength(100).optional(),
  child: idRule().optional(),
  week: isoDateRule().optional(),
})

export const staffCancelValidator = vine.create({
  reason: reasonRule(),
})

/**
 * "Same choice for all my children". It never confirms an allergy
 * (`confirmAllergy` is refused by the controller): a child whose allergen
 * the meal contains gets an error and is ordered for separately.
 */
export const applyAllValidator = vine.create({
  ...selectionFields,
  absent: vine.boolean().optional(),
  childIds: vine.array(idRule()).minLength(1).maxLength(10).distinct(),
})

/** Query string of the week views (invalid values fall back to defaults). */
export const orderWeekQueryValidator = vine.create({
  child: idRule().optional(),
  week: isoDateRule().optional(),
})

export const orderHistoryQueryValidator = vine.create({
  child: idRule().optional(),
  page: vine.number().withoutDecimals().range([1, 10000]).optional(),
})

/** Back-office order list filters. */
export const adminOrderListValidator = vine.create({
  date: isoDateRule().optional(),
  status: vine.enum(['all', ...ORDER_STATUSES] as const).optional(),
  q: vine.string().trim().maxLength(100).optional(),
  className: vine.string().trim().maxLength(60).optional(),
  page: vine.number().withoutDecimals().range([1, 10000]).optional(),
})

/** Removing an item from a published menu: how to resolve its orders. */
export const menuItemRemovalValidator = vine.create({
  mode: vine.enum(['switch', 'cancel'] as const).optional(),
  targetItemId: idRule().optional(),
  /** Affected orders shown on the impact page (refused if more exist now). */
  confirmedCount: vine.number().withoutDecimals().range([0, 1_000_000]).optional(),
})
