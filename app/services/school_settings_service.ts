import type School from '#models/school'
import type { SchoolSettings, StoredSchoolSettings } from '#types/school_settings'
import { schoolSettingsValidator } from '#validators/school_settings'

/**
 * Code defaults for every settings key (docs/ERD.md, docs/DECISIONS.md).
 * Adding a key here never needs a data migration.
 */
export const DEFAULT_SCHOOL_SETTINGS: Readonly<SchoolSettings> = Object.freeze({
  publish_weekday: 4, // D3 Thursday of the week before
  publish_time: '10:00',
  deadline_weekday: 7, // D4 Sunday of the week before
  deadline_time: '20:00',
  reminder_hours_before_deadline: 24, // D12
  allow_parent_edits: true, // D5
  edit_mode: 'until_cutoff',
  edit_cutoff_days_before: 1,
  edit_cutoff_time: '18:00',
  auto_assign_default_meal: true, // D10
  allergy_rule: 'block', // D9
  generate_moroccan_holidays: false, // D6
  ics_calendar_url: null, // D7
  email_notifications: {
    enabled: true,
    menu_published: true,
    deadline_reminder: true,
    holiday_cancellation: true,
    order_changed_by_staff: true,
    menu_change: true,
  },
  billing_mode: 'per_meal', // D1
  monthly_fee_cents: null,
  subscription_required_for_main_meal: true, // D2
  supplement_max_quantity: 5, // D14
  label_grid: { cols: 3, rows: 8 },
})

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Recursively merges `override` over `base`. Only keys known in `base` are
 * kept, so stale keys in the database never leak into the app.
 */
function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(base)) {
    const baseValue = base[key]
    const overrideValue = override[key]
    if (overrideValue === undefined) {
      result[key] = structuredClone(baseValue)
    } else if (isPlainObject(baseValue)) {
      result[key] = deepMerge(baseValue, overrideValue)
    } else {
      result[key] = overrideValue
    }
  }
  return result as T
}

export default class SchoolSettingsService {
  /**
   * Full settings of a school: stored JSON deep-merged over the defaults.
   */
  get(school: Pick<School, 'settings'>): SchoolSettings {
    return deepMerge(DEFAULT_SCHOOL_SETTINGS as SchoolSettings, school.settings ?? {})
  }

  /**
   * Validates a partial update, merges it over the stored settings and saves.
   * Throws a VineJS validation error on invalid input.
   */
  async update(school: School, input: unknown): Promise<SchoolSettings> {
    const changes = await schoolSettingsValidator.validate(input)
    const current = this.get(school)
    const next = deepMerge(current, changes)
    school.settings = next as StoredSchoolSettings
    await school.save()
    return next
  }
}
