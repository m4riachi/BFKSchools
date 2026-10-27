/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| Every variable is documented in `.env.example`.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  TZ: Env.schema.enum(['Africa/Casablanca'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

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

  // Mail: "smtp" (Mailpit in dev, real SMTP in prod) or "log" (writes mails to the logger)
  MAIL_MAILER: Env.schema.enum(['smtp', 'log'] as const),
  MAIL_FROM_NAME: Env.schema.string(),
  MAIL_FROM_ADDRESS: Env.schema.string({ format: 'email' }),
  SMTP_HOST: Env.schema.string.optional(),
  SMTP_PORT: Env.schema.number.optional(),
  SMTP_USERNAME: Env.schema.string.optional(),
  SMTP_PASSWORD: Env.schema.string.optional(),
})
