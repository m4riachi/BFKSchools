import vine from '@vinejs/vine'
import { isoDateRule } from '#validators/rules'
import { MEAL_TYPES } from '#enums/meals'
import { LABEL_GRID_LIMITS } from '#services/label_pdf_service'

/**
 * Query strings of the Phase 7 report pages (all GET, read-only). Invalid
 * values on the HTML pages fall back to defaults (today, all classes); the
 * file downloads answer 422 / redirect with the errors.
 */

/** Production / allergy sheet: `?date=YYYY-MM-DD` (default today). */
export const reportDayValidator = vine.create({
  date: isoDateRule().optional(),
})

const className = () => vine.string().trim().maxLength(60)

/** Back-office reports page (D38). */
export const adminReportQueryValidator = vine.create({
  from: isoDateRule().optional(),
  to: isoDateRule().optional(),
})

/** Labels page and PDF. */
/** D49: order tickets of a day, 3 or 4 per row. */
export const ticketsQueryValidator = vine.create({
  date: isoDateRule().optional(),
  className: className().optional(),
  cols: vine.number().withoutDecimals().range([3, 4]).optional(),
  format: vine.enum(['a4', 'roll'] as const).optional(),
})

export const labelsQueryValidator = vine.create({
  date: isoDateRule().optional(),
  className: className().optional(),
  cols: vine
    .number()
    .withoutDecimals()
    .range([...LABEL_GRID_LIMITS.cols])
    .optional(),
  rows: vine
    .number()
    .withoutDecimals()
    .range([...LABEL_GRID_LIMITS.rows])
    .optional(),
})

/** Exports: a period (day / week / month of `date`, or `from`–`to`) and filters. */
export const exportQueryValidator = vine.create({
  period: vine.enum(['day', 'week', 'month', 'custom'] as const).optional(),
  date: isoDateRule().optional(),
  from: isoDateRule().optional(),
  to: isoDateRule().optional(),
  className: className().optional(),
  mealType: vine.enum(MEAL_TYPES).optional(),
  kind: vine.enum(['detail', 'summary'] as const).optional(),
  format: vine.enum(['csv', 'xlsx', 'pdf'] as const).optional(),
})
