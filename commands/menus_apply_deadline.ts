import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import MenuJobs from '#services/menu_jobs'

/**
 * At the order deadline: auto-assign the day's default meal (D10) to
 * subscribed children with no order row. Once per menu.
 *
 * Crontab (docs/STACK_NOTES.md §7):  *\/5 * * * *  node ace menus:apply-deadline
 */
export default class MenusApplyDeadline extends BaseCommand {
  static commandName = 'menus:apply-deadline'
  static description = 'Apply the order deadline (auto-assign the default meal, D10)'
  static options: CommandOptions = { startApp: true }

  async run() {
    const jobs = await this.app.container.make(MenuJobs)
    const outcome = await jobs.applyDeadline()
    if (!outcome.acquired) {
      return this.logger.warning('menus:apply-deadline is already running; skipped')
    }
    const assigned = outcome.result.reduce((sum, menu) => sum + menu.assigned, 0)
    this.logger.info(
      `Deadline: ${outcome.result.length} menu(s) processed, ${assigned} default meal(s) assigned`
    )
  }
}
