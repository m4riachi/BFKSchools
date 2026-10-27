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
  billing_mode: vine.enum(['per_meal', 'monthly_fee'] as const).optional(),
  monthly_fee_cents: vine.number().withoutDecimals().min(0).nullable().optional(),
  subscription_required_for_main_meal: vine.boolean().optional(),
  supplement_max_quantity: vine.number().withoutDecimals().range([1, 20]).optional(),
  label_grid: vine
    .object({
      cols: vine.number().withoutDecimals().range([1, 6]).optional(),
      rows: vine.number().withoutDecimals().range([1, 20]).optional(),
    })
    .optional(),
})
