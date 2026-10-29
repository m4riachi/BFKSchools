import logger from '@adonisjs/core/services/logger'

/** Tasks waiting or running at once; more are dropped (and logged). */
export const DEFERRED_TASKS_MAX_PENDING = 100
/** Graceful shutdown waits at most this long for pending tasks. */
export const DEFERRED_TASKS_DRAIN_TIMEOUT_MS = 15_000

/**
 * Runs work after the current response is sent (next macrotask), so the
 * request path costs the same whatever the work does — used by "forgot
 * password" to avoid timing-based user enumeration.
 *
 * - At most DEFERRED_TASKS_MAX_PENDING tasks at once: further tasks are
 *   dropped with a warning (the user simply asks again). The callers are
 *   rate-limited, so this only bites under abuse; it keeps memory and SMTP
 *   connections bounded.
 * - Errors are logged with the task name and an address-free error code
 *   (never the error object: an SMTP error can carry the recipient).
 * - In-process only: work still pending when the process stops is lost.
 *
 * Bound as a container singleton; tests call `drain()` to await everything
 * scheduled so far.
 */
export default class DeferredTasks {
  #pending = new Set<Promise<void>>()

  get size() {
    return this.#pending.size
  }

  /** Returns false when the task was dropped because too many are pending. */
  run(name: string, work: () => Promise<unknown>): boolean {
    if (this.#pending.size >= DEFERRED_TASKS_MAX_PENDING) {
      logger.warn({ task: name, pending: this.#pending.size }, 'deferred task dropped (queue full)')
      return false
    }
    const task = new Promise<void>((resolve) => {
      setImmediate(() => {
        work()
          .catch((error) =>
            logger.error({ task: name, error: safeErrorCode(error) }, 'deferred task failed')
          )
          .finally(resolve)
      })
    })
    this.#pending.add(task)
    void task.finally(() => this.#pending.delete(task))
    return true
  }

  /**
   * Resolves once every task scheduled so far (and any they schedule) has
   * finished, or after `timeoutMs` (then returns false).
   */
  async drain(timeoutMs = DEFERRED_TASKS_DRAIN_TIMEOUT_MS): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
      timer.unref()
    })
    const all = (async () => {
      while (this.#pending.size) await Promise.all([...this.#pending])
      return true as const
    })()
    try {
      return await Promise.race([all, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
}

/** `name code` of an error, without its message (which may hold an address). */
export function safeErrorCode(error: unknown): string {
  const err = (error ?? {}) as { name?: unknown; code?: unknown; responseCode?: unknown }
  return [
    typeof err.name === 'string' ? err.name : 'Error',
    typeof err.code === 'string' ? err.code : null,
    typeof err.responseCode === 'number' ? String(err.responseCode) : null,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/[^\w .:-]/g, '')
    .slice(0, 120)
}
