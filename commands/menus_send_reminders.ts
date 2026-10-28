import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import MenuJobs from '#services/menu_jobs'

/**
 * Deadline reminders (D12: 24 h before the order deadline).
 * PHASE 5: registered in the schedule but a no-op — the order-dependent logic
 * is implemented in Phase 6 (see the INTEGRATION POINT in MenuJobs.sendReminders).
 *
 * Crontab (docs/STACK_NOTES.md §7):  *\/5 * * * *  node ace menus:send-reminders
 */
export default class MenusSendReminders extends BaseCommand {
  static commandName = 'menus:send-reminders'
  static description =
    'Email parents whose children have no selection before the deadline (Phase 6)'
  static options: CommandOptions = { startApp: true }

  async run() {
    const jobs = await this.app.container.make(MenuJobs)
    const outcome = await jobs.sendReminders()
    if (!outcome.acquired) {
      return this.logger.warning('menus:send-reminders is already running; skipped')
    }
    this.logger.info(
      `Reminders are implemented in Phase 6 (nothing sent; ${outcome.result.due} open menu(s))`
    )
  }
}
