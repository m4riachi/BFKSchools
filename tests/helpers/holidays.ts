import app from '@adonisjs/core/services/app'
import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'
import Holiday from '#models/holiday'
import HolidayImpactService from '#services/holiday_impact_service'
import HolidayGeneratorService from '#services/holiday_generator_service'
import type School from '#models/school'
import type { IsoDate } from '#support/dates'

/**
 * A school with the brief's test calendar (1 Sep → 30 Jun, Mon–Fri) and a
 * manager + an admin of that school.
 */
export async function setupHolidaySchool(
  year: { start: IsoDate; end: IsoDate } = { start: '2026-09-01', end: '2027-06-30' },
  settings: Record<string, unknown> = {}
) {
  const school = await SchoolFactory.merge({
    schoolYearStart: year.start,
    schoolYearEnd: year.end,
    schoolDays: [1, 2, 3, 4, 5],
    settings,
  }).create()
  const manager = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
  const admin = await UserFactory.apply('admin').merge({ schoolId: school.id }).create()
  return { school, manager, admin }
}

/** Listed (not deleted) rows of a school, by date then name. */
export function listedHolidays(schoolId: number) {
  return Holiday.query()
    .where('school_id', schoolId)
    .whereNull('deleted_at')
    .orderBy('date')
    .orderBy('name')
}

/**
 * Replaces HolidayImpactService with one that pretends `count` orders exist
 * and records the cancellations it is asked for.
 */
export function fakeImpact(count: number) {
  const cancelled: IsoDate[][] = []
  class FakeImpact extends HolidayImpactService {
    constructor() {
      // Its dependencies are never used: both methods are replaced.
      super(null as never, null as never, null as never)
    }
    async countAffectedOrders(_schoolId: number, dates: IsoDate[]) {
      return dates.length ? count : 0
    }
    async cancelAffectedOrders(_schoolId: number, dates: IsoDate[]) {
      cancelled.push(dates)
      return { cancelledOrders: count, notifiedParents: 0 }
    }
  }
  app.container.swap(HolidayImpactService, () => new FakeImpact())
  return { cancelled, restore: () => app.container.restore(HolidayImpactService) }
}

/** Runs the holiday generator for a school (same service as the button and the command). */
export async function generateHolidays(school: School) {
  const generator = await app.container.make(HolidayGeneratorService)
  return generator.generate(school)
}
