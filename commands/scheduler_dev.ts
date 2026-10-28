import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import Clock from '#services/clock'

/**
 * Development stand-in for the production crontab (docs/STACK_NOTES.md §7):
 * runs every scheduled command once a minute (the daily ones at start-up and
 * when the date changes) until stopped with Ctrl+C. Refused in production —
 * use cron there.
 */
const EVERY_MINUTE = [
  'menus:publish-due',
  'menus:send-reminders',
  'menus:apply-deadline',
  'mail:dispatch',
]
const DAILY = ['menus:close-past', 'holidays:generate']

export default class SchedulerDev extends BaseCommand {
  static commandName = 'scheduler:dev'
  static description = 'Development only: run the scheduled commands every minute (cron stand-in)'
  static options: CommandOptions = { startApp: true, staysAlive: true }

  #timer?: NodeJS.Timeout
  #lastDay = ''
  #running = false

  async run() {
    if (this.app.inProduction) {
      this.logger.error('scheduler:dev is for development; use cron in production')
      this.exitCode = 1
      return this.terminate()
    }
    this.logger.info('Running the scheduled commands every minute (Ctrl+C to stop)')
    await this.tick()
    this.#timer = setInterval(() => void this.tick(), 60_000)
    this.app.terminating(() => clearInterval(this.#timer))
  }

  async tick() {
    if (this.#running) return
    this.#running = true
    try {
      const clock = await this.app.container.make(Clock)
      const today = clock.today()
      const names = [...EVERY_MINUTE, ...(today !== this.#lastDay ? DAILY : [])]
      this.#lastDay = today
      for (const name of names) {
        try {
          await this.kernel.exec(name, [])
        } catch (error) {
          this.logger.error(`${name} failed: ${(error as Error).message}`)
        }
      }
    } finally {
      this.#running = false
    }
  }
}
