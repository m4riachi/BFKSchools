import { DateTime, type DurationLike } from 'luxon'
import app from '@adonisjs/core/services/app'
import Clock from '#services/clock'
import { APP_TIMEZONE } from '#support/time'

/**
 * A Clock stopped at a fixed instant. `travel()` moves it forward/backward.
 */
export class FrozenClock extends Clock {
  #now: DateTime

  constructor(at: string | DateTime, zone: string = APP_TIMEZONE) {
    super(zone)
    this.#now = FrozenClock.parse(at, zone)
  }

  static parse(at: string | DateTime, zone: string): DateTime {
    const value = typeof at === 'string' ? DateTime.fromISO(at, { zone }) : at.setZone(zone)
    if (!value.isValid) throw new TypeError(`Invalid frozen time "${String(at)}"`)
    return value
  }

  now(): DateTime {
    return this.#now
  }

  /** Jump to another instant (wall-clock strings are read in the business zone). */
  set(at: string | DateTime) {
    this.#now = FrozenClock.parse(at, this.zone)
    return this
  }

  /** Move the clock by a duration, e.g. `travel({ minutes: 2 })`. */
  travel(duration: DurationLike) {
    this.#now = this.#now.plus(duration)
    return this
  }
}

/**
 * Freezes time for code that resolves Clock from the container. Strings are
 * wall-clock times in Africa/Casablanca, e.g. freezeClock('2026-11-02T08:59').
 * Call `restoreClock()` in the test cleanup (or use `group.each.teardown`).
 */
export function freezeClock(at: string | DateTime): FrozenClock {
  const clock = new FrozenClock(at)
  app.container.swap(Clock, () => clock)
  return clock
}

export function restoreClock() {
  app.container.restore(Clock)
}
