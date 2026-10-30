import { BaseSeeder } from '@adonisjs/lucid/seeders'
import app from '@adonisjs/core/services/app'
import School from '#models/school'
import Holiday from '#models/holiday'
import HolidayGeneratorService from '#services/holiday_generator_service'
import HolidayService from '#services/holiday_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { assertDemoSeeding } from '#database/demo/support'

/**
 * Holidays of British Academy School Marrakech's configured school year: the US federal
 * holidays (same idempotent generator as the back-office button and
 * `holidays:generate`), plus two demo breaks added by hand (winter and
 * spring break, as an admin would). Runs before the demo menus/orders, so
 * nothing needs cancelling. Idempotent (breaks are matched by name).
 */
export default class HolidaySeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    assertDemoSeeding()
    const school = await School.findBy('slug', 'britech-school')
    if (!school) return
    const generator = await app.container.make(HolidayGeneratorService)
    await generator.generate(school, { confirmImpact: true, actor: null })

    const first = Number(school.schoolYearStart.slice(0, 4))
    const breaks = [
      { name: 'Winter break', startDate: `${first}-12-21`, endDate: `${first + 1}-01-01` },
      { name: 'Spring break', startDate: `${first + 1}-03-29`, endDate: `${first + 1}-04-02` },
    ]
    const holidays = await app.container.make(HolidayService)
    for (const range of breaks) {
      const exists = await Holiday.query()
        .where('school_id', school.id)
        .where('name', range.name)
        .first()
      if (exists) continue
      try {
        await holidays.createManual(school, range, { confirmImpact: true, actor: null })
      } catch (error) {
        // No school day in the range for this year's calendar: nothing to add.
        if (!(error instanceof BusinessRuleException)) throw error
      }
    }
  }
}
