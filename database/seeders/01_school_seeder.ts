import { BaseSeeder } from '@adonisjs/lucid/seeders'
import app from '@adonisjs/core/services/app'
import School from '#models/school'
import Clock from '#services/clock'
import { addDays, isoWeekday } from '#support/dates'

/**
 * The school year containing `today`: from the Monday on/after 20 August
 * to the Friday on/before 12 June (2026-08-24 → 2027-06-11 for 2026–27).
 */
export function schoolYearFor(today: string) {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const first = month >= 7 ? year : year - 1
  let start = `${first}-08-20`
  while (isoWeekday(start) !== 1) start = addDays(start, 1)
  let end = `${first + 1}-06-12`
  while (isoWeekday(end) !== 5) end = addDays(end, -1)
  return { start, end }
}

/**
 * The only school for now (also used in production to bootstrap the app).
 * Created once with the current school year; an existing school is left
 * as is (an admin may have changed its year or settings). Settings stay
 * '{}' so every setting uses the code defaults (SchoolSettingsService).
 */
export default class SchoolSeeder extends BaseSeeder {
  async run() {
    const existing = await School.findBy('slug', 'britech-school')
    if (existing) return

    const clock = await app.container.make(Clock)
    const year = schoolYearFor(clock.today())
    await School.create({
      slug: 'britech-school',
      name: 'Britech School',
      timezone: 'Africa/Casablanca',
      schoolDays: [1, 2, 3, 4, 5],
      schoolYearStart: year.start,
      schoolYearEnd: year.end,
      settings: {},
    })
  }
}
