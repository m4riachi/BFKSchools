import type { ApplicationService } from '@adonisjs/core/types'
import DeferredTasks from '#services/deferred_tasks'

/**
 * Application-wide singletons (other than the Clock, see time_provider).
 */
export default class AppServicesProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(DeferredTasks, () => new DeferredTasks())
  }

  /** Let deferred work (e.g. password-reset emails) finish on a graceful shutdown. */
  async shutdown() {
    const tasks = await this.app.container.make(DeferredTasks)
    await tasks.drain()
  }
}
