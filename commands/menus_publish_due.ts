import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import MenuJobs from '#services/menu_jobs'

/**
 * Publishes every `scheduled` weekly menu whose `publish_at` has passed
 * (catch-up: a missed run is handled by the next one), then queues the
 * parents' emails and notifications. Idempotent and advisory-locked.
 *
 * Crontab (docs/STACK_NOTES.md §7):  *\/5 * * * *  node ace menus:publish-due
 */
export default class MenusPublishDue extends BaseCommand {
  static commandName = 'menus:publish-due'
  static description = 'Publish the scheduled weekly menus whose publish time has passed'
  static options: CommandOptions = { startApp: true }

  async run() {
    const jobs = await this.app.container.make(MenuJobs)
    const outcome = await jobs.publishDue()
    if (!outcome.acquired)
      return this.logger.warning('menus:publish-due is already running; skipped')
    const published = outcome.result.filter((entry) => entry.published)
    const notReady = outcome.result.filter(
      (entry) => !entry.published && entry.reason === 'not_ready'
    )
    this.logger.info(
      `${published.length} menu(s) published` +
        (notReady.length ? `, ${notReady.length} not ready (left scheduled)` : '')
    )
  }
}
