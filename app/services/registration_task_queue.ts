import logger from '@adonisjs/core/services/logger'

/** Sign-ups running at once (each holds one database connection while it writes). */
export const REGISTRATION_TASKS_CONCURRENCY = 2
/** Sign-ups waiting or running; more are dropped (the public page answers the same anyway). */
export const REGISTRATION_TASKS_MAX_PENDING = 20

/**
 * D59 review (M1): QR sign-ups run after the response, like "forgot
 * password" (DeferredTasks), but in their own small queue — 2 at a time,
 * at most 20 waiting — so a flood of sign-ups can neither exhaust the
 * database pool nor fill the shared DeferredTasks queue and starve
 * password-reset emails. In-process: work still waiting when the process
 * stops is lost (the parent submits again). Bound as a container singleton;
 * tests call `drain()`.
 */
export default class RegistrationTaskQueue {
  #waiting: (() => Promise<void>)[] = []
  #running = 0
  #idle: (() => void)[] = []

  get size() {
    return this.#waiting.length + this.#running
  }

  /** Returns false when the task was dropped because the queue is full. */
  run(name: string, work: () => Promise<unknown>): boolean {
    if (this.size >= REGISTRATION_TASKS_MAX_PENDING) {
      logger.warn({ task: name, pending: this.size }, 'sign-up task dropped (queue full)')
      return false
    }
    this.#waiting.push(async () => {
      try {
        await work()
      } catch (error) {
        logger.error(
          { task: name, error: (error as { code?: string })?.code ?? 'Error' },
          'sign-up task failed'
        )
      }
    })
    setImmediate(() => this.#next())
    return true
  }

  #next() {
    while (this.#running < REGISTRATION_TASKS_CONCURRENCY && this.#waiting.length) {
      const task = this.#waiting.shift()!
      this.#running++
      void task().finally(() => {
        this.#running--
        this.#next()
        if (this.size === 0) for (const resolve of this.#idle.splice(0)) resolve()
      })
    }
  }

  /** Resolves once nothing is waiting or running. */
  drain(): Promise<void> {
    if (this.size === 0) return Promise.resolve()
    return new Promise((resolve) => this.#idle.push(resolve))
  }
}
