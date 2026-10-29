import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'
import { LogTransport } from '#app/mail/log_transport'
import { smtpTlsOptions } from '#support/env_guards'

const smtpUser = env.get('SMTP_USERNAME')

const mailConfig = defineConfig({
  default: env.get('MAIL_MAILER'),

  from: {
    address: env.get('MAIL_FROM_ADDRESS'),
    name: env.get('MAIL_FROM_NAME'),
  },

  globals: {
    brandName: 'BFK School Meals',
  },

  mailers: {
    /**
     * Mailpit in development (docker compose), the host's SMTP in production.
     */
    smtp: transports.smtp({
      host: env.get('SMTP_HOST', '127.0.0.1'),
      port: env.get('SMTP_PORT', 1025),
      // SMTP_SECURE=true → TLS from the start (465); production otherwise
      // requires STARTTLS unless the relay is on loopback (env_guards.ts).
      ...smtpTlsOptions({
        NODE_ENV: env.get('NODE_ENV'),
        SMTP_HOST: env.get('SMTP_HOST'),
        SMTP_SECURE: env.get('SMTP_SECURE'),
      }),
      // Bounded waits: a hung SMTP server must not hold a request, a
      // deferred task or a `mail:dispatch` run (cron) open for minutes
      // (nodemailer defaults: 2 min connect, 10 min socket).
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      ...(smtpUser
        ? {
            auth: {
              type: 'login' as const,
              user: smtpUser,
              pass: env.get('SMTP_PASSWORD', ''),
            },
          }
        : {}),
    }),

    /**
     * Development/test only (refused in production by start/env.ts): logs the
     * subject and masked recipients. MAIL_LOG_BODY=true adds the text body so
     * invitation links can be read in dev; it is ignored in production.
     */
    log: () => new LogTransport({ logBody: !app.inProduction && env.get('MAIL_LOG_BODY', false) }),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
