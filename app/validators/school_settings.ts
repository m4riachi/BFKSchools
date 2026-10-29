import vine from '@vinejs/vine'

const time = () => vine.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const weekday = () => vine.number().withoutDecimals().range([1, 7])

/**
 * Validates a (partial) update of `schools.settings`. Every key is optional;
 * the service merges the result over the stored settings.
 */
export const schoolSettingsValidator = vine.create({
  publish_weekday: weekday().optional(),
  publish_time: time().optional(),
  deadline_weekday: weekday().optional(),
  deadline_time: time().optional(),
  reminder_hours_before_deadline: vine.number().withoutDecimals().range([1, 168]).optional(),
  allow_parent_edits: vine.boolean().optional(),
  edit_mode: vine.enum(['until_cutoff', 'same_day_only'] as const).optional(),
  edit_cutoff_days_before: vine.number().withoutDecimals().range([0, 7]).optional(),
  edit_cutoff_time: time().optional(),
  auto_assign_default_meal: vine.boolean().optional(),
  allergy_rule: vine.enum(['block', 'warn_confirm'] as const).optional(),
  generate_moroccan_holidays: vine.boolean().optional(),
  ics_calendar_url: vine
    .string()
    .url({ protocols: ['https'], require_protocol: true })
    .nullable()
    .optional(),
  email_notifications: vine
    .object({
      enabled: vine.boolean().optional(),
      menu_published: vine.boolean().optional(),
      deadline_reminder: vine.boolean().optional(),
      holiday_cancellation: vine.boolean().optional(),
      order_changed_by_staff: vine.boolean().optional(),
      menu_change: vine.boolean().optional(),
    })
    .optional(),
  subscription_required_for_main_meal: vine.boolean().optional(),
  supplement_max_quantity: vine.number().withoutDecimals().range([1, 20]).optional(),
  label_grid: vine
    .object({
      cols: vine.number().withoutDecimals().range([1, 6]).optional(),
      rows: vine.number().withoutDecimals().range([1, 20]).optional(),
    })
    .optional(),
})

/**
 * The admin settings screen (brief §6): every editable key at once. School
 * days and the school year are columns of `schools`; the rest goes into
 * `schools.settings` through SchoolSettingsService (which re-validates it
 * with `schoolSettingsValidator`).
 */
export const schoolSettingsFormValidator = vine.create({
  schoolDays: vine.array(weekday()).minLength(1).maxLength(7).distinct(),
  schoolYearStart: vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  schoolYearEnd: vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  settings: vine.object({
    publish_weekday: weekday(),
    publish_time: time(),
    deadline_weekday: weekday(),
    deadline_time: time(),
    reminder_hours_before_deadline: vine.number().withoutDecimals().range([1, 168]),
    allow_parent_edits: vine.boolean(),
    edit_mode: vine.enum(['until_cutoff', 'same_day_only'] as const),
    edit_cutoff_days_before: vine.number().withoutDecimals().range([0, 7]),
    edit_cutoff_time: time(),
    auto_assign_default_meal: vine.boolean(),
    allergy_rule: vine.enum(['block', 'warn_confirm'] as const),
    generate_moroccan_holidays: vine.boolean(),
    email_notifications: vine.object({
      enabled: vine.boolean(),
      menu_published: vine.boolean(),
      deadline_reminder: vine.boolean(),
      holiday_cancellation: vine.boolean(),
      order_changed_by_staff: vine.boolean(),
      menu_change: vine.boolean(),
    }),
    subscription_required_for_main_meal: vine.boolean(),
    supplement_max_quantity: vine.number().withoutDecimals().range([1, 20]),
    /** Labels PDF grid (Phase 7). Optional so older clients keep working. */
    label_grid: vine
      .object({
        cols: vine.number().withoutDecimals().range([1, 6]),
        rows: vine.number().withoutDecimals().range([1, 20]),
      })
      .optional(),
  }),
})
