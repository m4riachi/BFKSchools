import { DateTime } from 'luxon'
import { APP_TIMEZONE } from '#support/time'

/**
 * The only source of "now" for business logic (golden rule 2).
 *
 * Resolve it from the container (`@inject()` or `app.container.make(Clock)`)
 * so tests can swap it with a frozen clock (see `tests/helpers/clock.ts`).
 */
export default class Clock {
  constructor(readonly zone: string = APP_TIMEZONE) {}

  /**
   * Current instant in the business time zone.
   */
  now(): DateTime {
    return DateTime.now().setZone(this.zone)
  }

  /**
   * Current business day as an ISO date string ('YYYY-MM-DD').
   */
  today(): string {
    return this.now().toISODate()!
  }
}
