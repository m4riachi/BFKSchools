import vine from '@vinejs/vine'
import { isoDateRule, nameRule } from '#validators/rules'

/** Database id (int4) sent by the browser. */
const idRule = () => vine.number().withoutDecimals().range([1, 2147483647])

/** Optional per-item cap on portions (Phase 6 enforces it when ordering). */
const maxQuantityRule = () => vine.number().withoutDecimals().range([1, 10000]).nullable()

/** A wall-clock date-time typed in the school's zone ('YYYY-MM-DDTHH:mm', datetime-local). */
const localDateTimeRule = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/)

export const menuItemCreateValidator = vine.create({
  date: isoDateRule(),
  mealId: idRule(),
  maxQuantity: maxQuantityRule().optional(),
})

export const menuItemUpdateValidator = vine.create({
  maxQuantity: maxQuantityRule(),
})

export const menuTimesValidator = vine.create({
  publishAt: localDateTimeRule(),
  orderDeadlineAt: localDateTimeRule(),
  notes: vine.string().trim().maxLength(2000).nullable().optional(),
})

export const menuTemplateSaveValidator = vine.create({
  name: nameRule(120),
  description: vine.string().trim().maxLength(500).nullable().optional(),
})

export const menuTemplateApplyValidator = vine.create({
  templateId: idRule(),
})

/** "Go to week" picker on the index page: any date, snapped to its Monday. */
export const menuWeekQueryValidator = vine.create({
  week: isoDateRule().optional(),
})
