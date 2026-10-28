import { BaseSeeder } from '@adonisjs/lucid/seeders'
import app from '@adonisjs/core/services/app'
import School from '#models/school'
import HolidayGeneratorService from '#services/holiday_generator_service'

/**
 * US federal holidays of Britech School's configured school year (the same
 * idempotent generator as the back-office button and `holidays:generate`).
 * Demo breaks/ICS data come with the Phase 9 seeders.
 */
export default class HolidaySeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    const school = await School.findBy('slug', 'britech-school')
    if (!school) return
    const generator = await app.container.make(HolidayGeneratorService)
    await generator.generate(school, { confirmImpact: true, actor: null })
  }
}
