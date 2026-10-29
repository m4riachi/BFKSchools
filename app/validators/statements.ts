import vine from '@vinejs/vine'

/** Database id (int4) sent by the browser. */
const idRule = () => vine.number().withoutDecimals().range([1, 2147483647])

/**
 * `?month=YYYY-MM` (+ optional child). The window (2000-01 … next month)
 * is checked by the controller with `isStatementMonth` (it depends on today).
 */
const month = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export const statementQueryValidator = vine.create({
  month: month().optional(),
  child: idRule().optional(),
})

export const schoolStatementQueryValidator = vine.create({
  month: month().optional(),
  q: vine.string().trim().maxLength(100).optional(),
  page: vine.number().withoutDecimals().range([1, 10_000]).optional(),
})

export const notificationListValidator = vine.create({
  page: vine.number().withoutDecimals().range([1, 10_000]).optional(),
})

/** Parent email preferences: only the opt-outable types (OPT_OUTABLE_EMAILS), never cancellations. */
export const notificationPreferencesValidator = vine.create({
  menu_published: vine.boolean(),
  deadline_reminder: vine.boolean(),
})
