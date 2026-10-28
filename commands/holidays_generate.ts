import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import School from '#models/school'
import HolidayGeneratorService from '#services/holiday_generator_service'
import { withAdvisoryLock } from '#support/advisory_lock'

/**
 * Scheduled holiday generation (brief §5.3 "a yearly scheduled job"). For
 * every school (or `--school=<id>`), generates the US federal holidays — and
 * the Moroccan fixed-date ones when the school setting is on — for the
 * school's configured year. Idempotent (rule_key + tombstones), so it is safe
 * to run daily: it creates rows only after an admin sets a new school year.
 *
 * Crontab (docs/STACK_NOTES.md §7; the scheduler itself is set up in Phase 5):
 *   30 2 * * *  cd /app && node ace holidays:generate
 *
 * No one can be asked to confirm here: orders on new holiday dates are
 * cancelled through HolidayImpactService (a no-op until Phase 6).
 */
export default class HolidaysGenerate extends BaseCommand {
  static commandName = 'holidays:generate'
  static description =
    'Generate the US federal (and optional Moroccan) holidays of each school year (idempotent)'

  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'Only this school id' })
  declare school?: number

  async run() {
    const generator = await this.app.container.make(HolidayGeneratorService)
    const outcome = await withAdvisoryLock('holidays:generate', async () => {
      const query = School.query().orderBy('id')
      if (this.school !== undefined) query.where('id', this.school)
      const schools = await query
      if (schools.length === 0) this.logger.warning('No school found')
      for (const school of schools) {
        const result = await generator.generate(school, { confirmImpact: true, actor: null })
        this.logger.info(
          `${school.name} ${result.schoolYearStart} → ${result.schoolYearEnd}: ` +
            `${result.created} created, ${result.skipped} already present/disabled/deleted` +
            (result.moroccan ? ' (Moroccan holidays on)' : '')
        )
      }
    })
    if (!outcome.acquired) {
      this.logger.warning('holidays:generate is already running; skipped')
    }
  }
}
