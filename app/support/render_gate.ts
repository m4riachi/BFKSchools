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
