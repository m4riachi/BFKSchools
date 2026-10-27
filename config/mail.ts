import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'
import { LogTransport } from '#app/mail/log_transport'

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
     * No SMTP server needed: mails are written to the logger.
     */
    log: () => new LogTransport(),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
