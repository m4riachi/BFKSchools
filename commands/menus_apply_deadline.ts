import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import MenuJobs from '#services/menu_jobs'

/**
 * At the order deadline: auto-assign the default meal (D10).
 * PHASE 5: registered in the schedule but a no-op — the order-dependent logic
 * is implemented in Phase 6 (see the INTEGRATION POINT in MenuJobs.applyDeadline).
 *
 * Crontab (docs/STACK_NOTES.md §7):  *\/5 * * * *  node ace menus:apply-deadline
 */
export default class MenusApplyDeadline extends BaseCommand {
  static commandName = 'menus:apply-deadline'
  static description = 'Apply the order deadline (auto-assign default meals, Phase 6)'
  static options: CommandOptions = { startApp: true }

  async run() {
    const jobs = await this.app.container.make(MenuJobs)
    const outcome = await jobs.applyDeadline()
    if (!outcome.acquired) {
      return this.logger.warning('menus:apply-deadline is already running; skipped')
    }
    this.logger.info(
      `Deadline processing is implemented in Phase 6 (nothing done; ${outcome.result.due} menu(s) past their deadline)`
    )
  }
}
