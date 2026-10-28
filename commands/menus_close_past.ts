import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import MenuJobs from '#services/menu_jobs'

/**
 * Closes the published weekly menus whose week is over (published → closed).
 * Idempotent and advisory-locked.
 *
 * Crontab (docs/STACK_NOTES.md §7):  15 2 * * *  node ace menus:close-past
 */
export default class MenusClosePast extends BaseCommand {
  static commandName = 'menus:close-past'
  static description = 'Close the published weekly menus whose week is over'
  static options: CommandOptions = { startApp: true }

  async run() {
    const jobs = await this.app.container.make(MenuJobs)
    const outcome = await jobs.closePast()
    if (!outcome.acquired)
      return this.logger.warning('menus:close-past is already running; skipped')
    this.logger.info(
      `${outcome.result.closed} menu(s) closed, ${outcome.result.unscheduled} stale scheduled menu(s) moved back to draft`
    )
  }
}
