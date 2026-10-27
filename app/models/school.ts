import { SchoolSchema } from '#database/schema'

/**
 * A school served by BFK. Read settings through SchoolSettingsService,
 * never `school.settings` directly (it only holds overrides).
 */
export default class School extends SchoolSchema {}
