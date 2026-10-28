import logger from '@adonisjs/core/services/logger'

/**
 * Runs work after the current response is sent (next macrotask), so the
 * request path costs the same whatever the work does — used by "forgot
 * password" to avoid timing-based user enumeration.
 *
 * Errors are logged (with the task name only) and never reach the client.
 * In-process only: work still pending when the process stops is lost (the
 * user simply asks again). Bound as a container singleton; tests call
 * `drain()` to await everything scheduled so far.
 */
export default class DeferredTasks {
  #pending = new Set<Promise<void>>()

  run(name: string, work: () => Promise<unknown>) {
    const task = new Promise<void>((resolve) => {
      setImmediate(() => {
        work()
          .catch((error) => logger.error({ err: error, task: name }, 'deferred task failed'))
          .finally(resolve)
      })
    })
    this.#pending.add(task)
    void task.finally(() => this.#pending.delete(task))
  }

  /** Resolves once every task scheduled so far (and any they schedule) has finished. */
  async drain() {
    while (this.#pending.size) await Promise.all([...this.#pending])
  }
}
