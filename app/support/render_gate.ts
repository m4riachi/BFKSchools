/**
 * Caps how many CPU-heavy renders (PDFs) run at the same time in this
 * process. pdfkit is synchronous: renders also yield between chunks
 * (`yieldToLoop`), and the gate keeps a burst of downloads from piling up
 * work on the event loop. Waiting renders run in arrival order; past
 * `maxWaiting` the request is refused (`RenderBusyError` → HTTP 503).
 */
export class RenderBusyError extends Error {
  constructor() {
    super('Too many renders in progress')
    this.name = 'RenderBusyError'
  }
}

/** A user already has their share of renders in flight (D27) → HTTP 429. */
export class UserRenderLimitError extends RenderBusyError {
  constructor() {
    super()
    this.message = 'Too many renders in progress for this user'
    this.name = 'UserRenderLimitError'
  }
}

/** The client went away before its render started: the work is skipped. */
export class ClientGoneError extends Error {
  constructor() {
    super('Client disconnected before the render started')
    this.name = 'ClientGoneError'
  }
}

export class RenderGate {
  #running = 0
  #queue: Array<() => void> = []

  constructor(
    readonly maxConcurrent: number,
    readonly maxWaiting: number
  ) {}

  get running() {
    return this.#running
  }

  get waiting() {
    return this.#queue.length
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#running >= this.maxConcurrent) {
      if (this.#queue.length >= this.maxWaiting) throw new RenderBusyError()
      await new Promise<void>((resolve) => this.#queue.push(resolve))
    } else {
      this.#running += 1
    }
    try {
      return await work()
    } finally {
      const next = this.#queue.shift()
      // The slot passes straight to the next waiter (the count stays the same).
      if (next) next()
      else this.#running -= 1
    }
  }
}

/** Every PDF of the app (labels, statements): 2 at a time, 20 waiting. */
export const pdfRenderGate = new RenderGate(2, 20)

/**
 * D27 — fairness on top of the server-wide gate: each user has at most
 * `maxRunning` render running and `maxWaiting` waiting (1 + 1). Their
 * renders run one after the other; one more is refused with
 * UserRenderLimitError (HTTP 429), so a single user can neither fill the
 * shared queue nor make every other download a 503. A render whose client
 * disconnected while it waited is skipped (`isGone`, checked right before
 * the work starts) instead of burning CPU for nobody.
 */
export class PerUserRenderGate {
  #users = new Map<string | number, { inFlight: number; tail: Promise<unknown> }>()

  constructor(
    readonly shared: RenderGate,
    readonly maxRunning = 1,
    readonly maxWaiting = 1
  ) {}

  inFlight(key: string | number) {
    return this.#users.get(key)?.inFlight ?? 0
  }

  async run<T>(
    key: string | number,
    work: () => Promise<T>,
    isGone: () => boolean = () => false
  ): Promise<T> {
    const entry = this.#users.get(key) ?? { inFlight: 0, tail: Promise.resolve() }
    if (entry.inFlight >= this.maxRunning + this.maxWaiting) throw new UserRenderLimitError()
    entry.inFlight += 1
    this.#users.set(key, entry)

    // maxRunning = 1: chain this user's renders one after the other.
    const previous = entry.tail
    const current = previous
      .catch(() => {})
      .then(() => {
        if (isGone()) throw new ClientGoneError()
        return this.shared.run(() => {
          if (isGone()) throw new ClientGoneError()
          return work()
        })
      })
    entry.tail = current.catch(() => {})
    try {
      return await current
    } finally {
      entry.inFlight -= 1
      if (entry.inFlight === 0) this.#users.delete(key)
    }
  }
}

/** Every PDF of the app, per user (D27): 1 running + 1 waiting each. */
export const pdfUserRenderGate = new PerUserRenderGate(pdfRenderGate, 1, 1)
