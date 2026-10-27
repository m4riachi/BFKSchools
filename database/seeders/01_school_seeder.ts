import { BaseSeeder } from '@adonisjs/lucid/seeders'
import School from '#models/school'

/**
 * The only school for now. Settings stay '{}' so every setting uses the
 * code defaults (SchoolSettingsService) until an admin changes it.
 */
export default class SchoolSeeder extends BaseSeeder {
  async run() {
    await School.updateOrCreate(
      { slug: 'britech-school' },
      {
        name: 'Britech School',
        timezone: 'Africa/Casablanca',
        schoolDays: [1, 2, 3, 4, 5],
        schoolYearStart: '2026-08-24',
        schoolYearEnd: '2027-06-11',
      }
    )
  }
}
