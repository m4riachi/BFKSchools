import { IANAZone } from 'luxon'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/**
 * Business time zone of BFK School Meals. Always the IANA name: Morocco's UTC
 * offset changes (Ramadan), so a fixed offset like "+01:00" is never correct.
 */
export const APP_TIMEZONE = 'Africa/Casablanca'

/** Instants when the zone's UTC offset changes, within these years. */
const OFFSET_TABLE_YEARS = [2020, 2036] as const

export type ZoneOffset = { fromMs: number; offsetMinutes: number }

const offsetTables = new Map<string, ZoneOffset[]>()

/**
 * The zone's UTC offsets over time, from the server's time zone data, for the
 * browser (D41). Browsers ship their own copy of this data, and it can be out
 * of date: Chrome 146 still has Morocco at UTC+1 after its return to UTC on
 * 20 Sep 2026, so it cannot be trusted to show Casablanca hours.
 */
export function zoneOffsets(name: string = APP_TIMEZONE): ZoneOffset[] {
  const cached = offsetTables.get(name)
  if (cached) return cached

  const zone = IANAZone.create(name)
  const end = Date.UTC(OFFSET_TABLE_YEARS[1], 0, 1)
  let current = Date.UTC(OFFSET_TABLE_YEARS[0], 0, 1)
  const table: ZoneOffset[] = [{ fromMs: current, offsetMinutes: zone.offset(current) }]
  while (current < end) {
    const next = current + DAY_MS
    if (zone.offset(next) !== zone.offset(current)) {
      // Binary search for the minute of the change inside this day.
      let low = current
      let high = next
      while (high - low > MINUTE_MS) {
        const middle = low + Math.floor((high - low) / 2 / MINUTE_MS) * MINUTE_MS
        if (zone.offset(middle) === zone.offset(current)) low = middle
        else high = middle
      }
      table.push({ fromMs: high, offsetMinutes: zone.offset(high) })
    }
    current = next
  }
  offsetTables.set(name, table)
  return table
}
