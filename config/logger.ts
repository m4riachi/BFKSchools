import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, targets } from '@adonisjs/core/logger'

const loggerConfig = defineConfig({
  /**
   * Default logger name used by ctx.logger and app logger calls.
   */
  default: 'app',

  loggers: {
    app: {
      /**
       * Toggle this logger on/off.
       */
      enabled: true,

      /**
       * Logger name shown in log records.
       */
      name: env.get('APP_NAME'),

      /**
       * Minimum level to output (trace, debug, info, warn, error, fatal).
       */
      level: env.get('LOG_LEVEL'),

      /**
       * Defence in depth: no log line may carry a password, a token or a
       * cookie, even if a future log call passes a whole object (the app
       * itself only logs masked emails and error codes).
       */
      redact: {
        paths: [
          'password',
          'password_confirmation',
          'currentPassword',
          'token',
          '*.password',
          '*.password_confirmation',
          '*.currentPassword',
          '*.token',
          '*.tokenHash',
          '*.token_hash',
          'req.headers.cookie',
          'req.headers.authorization',
          'headers.cookie',
          'headers.authorization',
          'err.detail',
          'err.where',
          'err.parameters',
          'err.bindings',
          'error.detail',
        ],
        censor: '[redacted]',
      },

      /**
       * Configure where logs are written.
       * Pretty logs in development, stdout in production.
       */
      transport: {
        targets: targets()
          .pushIf(!app.inProduction, targets.pretty())
          .pushIf(app.inProduction, targets.file({ destination: 1 }))
          .toArray(),
      },
    },
  },
})

export default loggerConfig

/**
 * Inferring types for the list of loggers you have configured
 * in your application.
 */
declare module '@adonisjs/core/types' {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
