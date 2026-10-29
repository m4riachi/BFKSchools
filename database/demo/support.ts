import app from '@adonisjs/core/services/app'
import type { DateTime } from 'luxon'
import Clock from '#services/clock'
import { PASSWORD_MAX_LENGTH, passwordStrengthIssues } from '#validators/rules'

/**
 * Helpers shared by the demo seeders.
 *
 * Demo seeders declare `static environment = ['development', 'test']`
 * (so `node ace db:seed` skips them in production) AND call
 * `assertDemoSeeding()` first. The only way to load demo data into a
 * production database (e.g. a test deployment) is `node ace bfk:seed demo`
 * with ALLOW_DEMO_SEED=true and a strong BFK_DEMO_PASSWORD: demo accounts
 * then never get the public development password.
 */
export function inProductionEnv() {
  return app.inProduction || process.env.NODE_ENV === 'production'
}

export function assertDemoSeeding(production = inProductionEnv()) {
  if (production && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error(
      'Demo seeders never run in production unless ALLOW_DEMO_SEED=true (use "node ace bfk:seed demo").'
    )
  }
}

/** Password of every demo account in development/test (never used in production). */
export const DEMO_PASSWORD = 'Demo1234!'

/** The password given to demo accounts: BFK_DEMO_PASSWORD in production (required, strong). */
export function demoPassword(production = inProductionEnv()): string {
  if (!production) return DEMO_PASSWORD
  const password = process.env.BFK_DEMO_PASSWORD ?? ''
  if (passwordStrengthIssues(password).length || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(
      'In production, set BFK_DEMO_PASSWORD (10–128 characters, at least one letter and one digit) before seeding demo accounts.'
    )
  }
  return password
}

/** Domain of the generated demo families (the four role accounts keep @bfk.test). */
export const DEMO_FAMILY_DOMAIN = 'demo.bfk.test'

/** A clock stopped at one instant (business code reads "now" from Clock only). */
class FixedClock extends Clock {
  constructor(protected at: DateTime) {
    super()
  }

  now(): DateTime {
    return this.at.setZone(this.zone)
  }
}

/**
 * Runs `work` with the container's Clock frozen at `at`. Services must be
 * resolved inside `work` (`app.container.make`) to receive that clock.
 */
export async function atInstant<T>(at: DateTime, work: () => Promise<T>): Promise<T> {
  app.container.swap(Clock, () => new FixedClock(at))
  try {
    return await work()
  } finally {
    app.container.restore(Clock)
  }
}

/** Deterministic pseudo-random numbers in [0, 1) from a text seed (mulberry32). */
export function randomFor(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let state = h >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length) % list.length]
}

/** Logs a line from a seeder (dev/test tooling only). */
export function say(line: string) {
  process.stdout.write(`${line}\n`)
}
