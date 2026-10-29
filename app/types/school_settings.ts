/**
 * Keys of `schools.settings` (docs/ERD.md §schools.settings).
 * Times are 'HH:mm' wall-clock strings in the school's IANA zone.
 */
export type EditMode = 'until_cutoff' | 'same_day_only'
export type AllergyRule = 'block' | 'warn_confirm'

export type EmailNotificationSettings = {
  enabled: boolean
  menu_published: boolean
  deadline_reminder: boolean
  holiday_cancellation: boolean
  order_changed_by_staff: boolean
  menu_change: boolean
}

export type SchoolSettings = {
  publish_weekday: number
  publish_time: string
  deadline_weekday: number
  deadline_time: string
  reminder_hours_before_deadline: number
  allow_parent_edits: boolean
  edit_mode: EditMode
  edit_cutoff_days_before: number
  edit_cutoff_time: string
  auto_assign_default_meal: boolean
  allergy_rule: AllergyRule
  generate_moroccan_holidays: boolean
  ics_calendar_url: string | null
  email_notifications: EmailNotificationSettings
  subscription_required_for_main_meal: boolean
  supplement_max_quantity: number
  label_grid: { cols: number; rows: number }
}

/**
 * What is stored in the jsonb column: any subset of the keys. Missing keys
 * fall back to the code defaults (SchoolSettingsService deep-merges them).
 */
export type StoredSchoolSettings = {
  [K in keyof SchoolSettings]?: SchoolSettings[K] extends object | null
    ? Partial<NonNullable<SchoolSettings[K]>> | null
    : SchoolSettings[K]
}
