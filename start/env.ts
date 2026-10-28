/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| Every variable is documented in `.env.example`.
|
*/

import { Env } from '@adonisjs/core/env'
import { assertDriveEnv, assertSafeProductionEnv, parseTrustProxy } from '#support/env_guards'

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
  // Outbox (D16): emails sent per `mail:dispatch` run (cron: every minute)
  // and per rolling hour (the SMTP host's hourly limit). See config/outbox.ts.
  MAIL_MAX_PER_RUN: Env.schema.number.optional(),
  MAIL_MAX_PER_HOUR: Env.schema.number.optional(),

  // File storage (meal photos). "fs" = local disk under storage/ (dev/test),
  // "s3" = any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, …) in
  // production. The S3_* variables are required only when DRIVE_DISK=s3
  // (checked by assertDriveEnv below).
  DRIVE_DISK: Env.schema.enum(['fs', 's3'] as const),
  S3_ACCESS_KEY_ID: Env.schema.string.optional(),
  S3_SECRET_ACCESS_KEY: Env.schema.secret.optional(),
  S3_REGION: Env.schema.string.optional(),
  S3_BUCKET: Env.schema.string.optional(),
  S3_ENDPOINT: Env.schema.string.optional({ format: 'url', tld: false }),
  S3_FORCE_PATH_STYLE: Env.schema.boolean.optional(),
  // Only when the signed-URL origin can't be derived (see storage_origin.ts):
  // the https origin (no path) to allow in the CSP img-src.
  S3_PUBLIC_ORIGIN: Env.schema.string.optional(),
})

assertSafeProductionEnv({ NODE_ENV: env.get('NODE_ENV'), MAIL_MAILER: env.get('MAIL_MAILER') })
parseTrustProxy(env.get('TRUST_PROXY'))
assertDriveEnv({
  NODE_ENV: env.get('NODE_ENV'),
  DRIVE_DISK: env.get('DRIVE_DISK'),
  S3_ENDPOINT: env.get('S3_ENDPOINT'),
  S3_FORCE_PATH_STYLE: env.get('S3_FORCE_PATH_STYLE'),
  S3_PUBLIC_ORIGIN: env.get('S3_PUBLIC_ORIGIN'),
  S3_ACCESS_KEY_ID: env.get('S3_ACCESS_KEY_ID'),
  S3_SECRET_ACCESS_KEY: env.get('S3_SECRET_ACCESS_KEY')?.release(),
  S3_REGION: env.get('S3_REGION'),
  S3_BUCKET: env.get('S3_BUCKET'),
})

export default env
