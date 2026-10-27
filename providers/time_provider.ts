import pg from 'pg'
import { Settings } from 'luxon'
import type { ApplicationService } from '@adonisjs/core/types'
import Clock from '#services/clock'
import { APP_TIMEZONE } from '#support/time'

/**
 * PostgreSQL type OID of `date`.
 */
const PG_DATE_OID = 1082

/**
 * Time setup, registered before any other code runs:
 * - process time zone and Luxon default zone = Africa/Casablanca;
 * - pg returns `date` columns as plain 'YYYY-MM-DD' strings (no JS Date,
 *   so no time-zone shift is possible);
 * - the Clock service is a container singleton (tests swap it).
 */
export default class TimeProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    process.env.TZ = APP_TIMEZONE
    Settings.defaultZone = APP_TIMEZONE
    pg.types.setTypeParser(PG_DATE_OID, (value: string) => value)

    this.app.container.singleton(Clock, () => new Clock(APP_TIMEZONE))
  }
}
