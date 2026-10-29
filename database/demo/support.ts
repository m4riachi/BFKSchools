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

/**
 * A placeholder meal photo generated locally (no binary in the repo, no
 * hot-linked image): a plate seen from above in the meal's colors, as a
 * PNG that then goes through the normal upload pipeline (sharp → WebP).
 * Shapes only — no text, so no font is needed on the machine.
 */
export async function placeholderPhoto(colors: [string, string, string], variant = 0) {
  const { default: sharp } = await import('sharp')
  const [background, food, garnish] = colors
  const random = randomFor(`${colors.join('')}:${variant}`)
  const blobs = Array.from({ length: 7 }, (_, index) => {
    const angle = (index / 7) * Math.PI * 2 + random()
    const radius = 70 + random() * 60
    const x = 400 + Math.cos(angle) * radius
    const y = 300 + Math.sin(angle) * radius * 0.8
    const size = 34 + random() * 30
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}" fill="${index % 3 === 0 ? garnish : food}" opacity="0.92"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="100%" stop-color="${background}"/></radialGradient></defs>
  <rect width="800" height="600" fill="${background}"/><rect width="800" height="600" fill="url(#g)"/>
  <ellipse cx="400" cy="318" rx="250" ry="215" fill="#000000" opacity="0.10"/>
  <ellipse cx="400" cy="300" rx="250" ry="215" fill="#fbfaf7"/>
  <ellipse cx="400" cy="300" rx="190" ry="160" fill="#f1eee6"/>
  <ellipse cx="400" cy="300" rx="150" ry="120" fill="${food}" opacity="0.85"/>
  ${blobs}
  <rect x="95" y="160" width="18" height="300" rx="9" fill="#c9c4b8"/>
  <rect x="687" y="160" width="18" height="300" rx="9" fill="#c9c4b8"/>
</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** Logs a line from a seeder (dev/test tooling only). */
export function say(line: string) {
  process.stdout.write(`${line}\n`)
}
