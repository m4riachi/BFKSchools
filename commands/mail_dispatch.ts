import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import MenuJobs from '#services/menu_jobs'

/**
 * Sends the due emails of the outbox (D16) within MAIL_MAX_PER_RUN and
 * MAIL_MAX_PER_HOUR, retrying failures with backoff (failed after 5 attempts).
 * Advisory-locked; logs never contain full addresses or bodies.
 *
 * Crontab (docs/STACK_NOTES.md §7):  * * * * *  node ace mail:dispatch
 */
export default class MailDispatch extends BaseCommand {
  static commandName = 'mail:dispatch'
  static description = 'Send the queued emails of the outbox (capped per run and per hour)'
  static options: CommandOptions = { startApp: true }

  async run() {
    const jobs = await this.app.container.make(MenuJobs)
    const outcome = await jobs.dispatchMail()
    if (!outcome.acquired) return this.logger.warning('mail:dispatch is already running; skipped')
    const { budget, sent, retried, failed, skipped } = outcome.result
    this.logger.info(
      `outbox: ${sent} sent, ${retried} to retry, ${failed} failed, ${skipped} skipped (budget ${budget})`
    )
  }
}
