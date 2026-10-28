/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| Every variable is documented in `.env.example`.
|
*/

import { Env } from '@adonisjs/core/env'
import { assertSafeProductionEnv, parseTrustProxy } from '#support/env_guards'

const env = await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  TZ: Env.schema.enum(['Africa/Casablanca'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Reverse proxy whose X-Forwarded-For is trusted (see app/support/env_guards.ts).
  // Unset = "loopback" (proxy on the same host), "false" = none.
  TRUST_PROXY: Env.schema.string.optional(),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Database (PostgreSQL)
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  // Rate limiter store (database in dev/prod, memory in tests)
  LIMITER_STORE: Env.schema.enum(['database', 'memory'] as const),

  // Mail: "smtp" (Mailpit in dev, real SMTP in prod) or "log" (dev/test only:
  // logs subject + masked recipient). MAIL_LOG_BODY=true also logs the text
  // body (dev only, ignored in production).
  MAIL_MAILER: Env.schema.enum(['smtp', 'log'] as const),
  MAIL_LOG_BODY: Env.schema.boolean.optional(),
  MAIL_FROM_NAME: Env.schema.string(),
  MAIL_FROM_ADDRESS: Env.schema.string({ format: 'email' }),
  SMTP_HOST: Env.schema.string.optional(),
  SMTP_PORT: Env.schema.number.optional(),
  SMTP_USERNAME: Env.schema.string.optional(),
  SMTP_PASSWORD: Env.schema.string.optional(),
})

assertSafeProductionEnv({ NODE_ENV: env.get('NODE_ENV'), MAIL_MAILER: env.get('MAIL_MAILER') })
parseTrustProxy(env.get('TRUST_PROXY'))

export default env
