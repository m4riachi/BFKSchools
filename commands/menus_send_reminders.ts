import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import MenuJobs from '#services/menu_jobs'

/**
 * Deadline reminders (D12: `reminder_hours_before_deadline`, 24 h by
 * default): notify + email parents who still have a child without a
 * selection on some open day of the week. Once per menu.
 *
 * Crontab (docs/STACK_NOTES.md §7):  *\/5 * * * *  node ace menus:send-reminders
 */
export default class MenusSendReminders extends BaseCommand {
  static commandName = 'menus:send-reminders'
  static description = 'Remind parents whose children have no selection before the order deadline'
  static options: CommandOptions = { startApp: true }

  async run() {
    const jobs = await this.app.container.make(MenuJobs)
    const outcome = await jobs.sendReminders()
    if (!outcome.acquired) {
      return this.logger.warning('menus:send-reminders is already running; skipped')
    }
    const parents = outcome.result.reduce((sum, menu) => sum + menu.parents, 0)
    this.logger.info(
      `Reminders: ${outcome.result.length} menu(s) processed, ${parents} parent(s) reminded`
    )
  }
}
