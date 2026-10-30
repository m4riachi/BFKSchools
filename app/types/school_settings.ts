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
  /** D33: allergens module (rules + display). Off = data kept, nothing applied or shown. */
  allergens_enabled: boolean
  allergy_rule: AllergyRule
  /** D33: kitchen labels module (page + PDF). */
  labels_enabled: boolean
  /** D33: child fields Niveau / Classe (forms, sheets, exports, PDFs). Off = values kept, hidden. */
  grade_enabled: boolean
  class_enabled: boolean
  generate_moroccan_holidays: boolean
  ics_calendar_url: string | null
  /** D34: support number in international format, digits only (wa.me). Null = no button. */
  support_whatsapp: string | null
  /** D37: "Commande à domicile" button of the parent portal. Null = no button. */
  delivery_order_url: string | null
  /** D37: Glovo button of the parent portal. Null = no button. */
  glovo_url: string | null
  email_notifications: EmailNotificationSettings
  subscription_required_for_main_meal: boolean
  /** D35: amount of one subscription meal, stored only for now (not billed, D31). */
  subscription_meal_price_cents: number | null
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
