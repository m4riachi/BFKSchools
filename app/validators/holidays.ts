import vine from '@vinejs/vine'
import { HOLIDAY_PERIOD_FILTERS, HOLIDAY_SOURCES, HOLIDAY_STATUS_FILTERS } from '#enums/holidays'
import { HOLIDAY_NAME_MAX_LENGTH, ICS_IMPORT } from '#config/holidays'
import { isoDateRule, nameRule } from '#validators/rules'

/** `confirmImpact`: the admin confirmed the cancellation of affected orders. */
const confirmImpact = () => vine.boolean().optional()

/** A manual holiday: one day, or a range when `endDate` is after `startDate`. */
export const holidayCreateValidator = vine.create({
  name: nameRule(HOLIDAY_NAME_MAX_LENGTH),
  startDate: isoDateRule(),
  endDate: isoDateRule().nullable().optional(),
  confirmImpact: confirmImpact(),
})

/** One row: rename (any source); move (manual single days only). */
export const holidayUpdateValidator = vine.create({
  name: nameRule(HOLIDAY_NAME_MAX_LENGTH),
  date: isoDateRule().nullable().optional(),
  confirmImpact: confirmImpact(),
})

/** A range: rename (any source); change dates (manual ranges only). */
export const holidayGroupUpdateValidator = vine.create({
  name: nameRule(HOLIDAY_NAME_MAX_LENGTH),
  startDate: isoDateRule().nullable().optional(),
  endDate: isoDateRule().nullable().optional(),
  confirmImpact: confirmImpact(),
})

export const holidayToggleValidator = vine.create({
  active: vine.boolean(),
  confirmImpact: confirmImpact(),
})

export const holidayGenerateValidator = vine.create({
  confirmImpact: confirmImpact(),
})

export const holidaySettingsValidator = vine.create({
  generateMoroccanHolidays: vine.boolean(),
})

export const icsUploadValidator = vine.create({
  calendar: vine.file({ size: ICS_IMPORT.maxBytes, extnames: ['ics', 'ical', 'ifb', 'icalendar'] }),
})

export const icsUrlValidator = vine.create({
  url: vine
    .string()
    .trim()
    .maxLength(2048)
    .url({ require_protocol: true, protocols: ['https'] }),
})

export const icsConfirmValidator = vine.create({
  importId: vine.string().uuid({ version: [4] }),
  ranges: vine
    .array(vine.string().maxLength(100))
    .minLength(1)
    .maxLength(ICS_IMPORT.maxPreviewRanges)
    .distinct(),
  confirmImpact: confirmImpact(),
})

/** Query string of the holidays page (invalid values fall back to defaults). */
export const holidayListValidator = vine.create({
  view: vine.enum(['calendar', 'list'] as const).optional(),
  month: vine
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  q: vine.string().trim().maxLength(100).optional(),
  source: vine.enum(HOLIDAY_SOURCES).optional(),
  status: vine.enum(HOLIDAY_STATUS_FILTERS).optional(),
  period: vine.enum(HOLIDAY_PERIOD_FILTERS).optional(),
  page: vine.number().withoutDecimals().min(1).max(10_000).optional(),
})
