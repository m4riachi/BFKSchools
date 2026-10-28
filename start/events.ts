/*
|--------------------------------------------------------------------------
| Event listeners
|--------------------------------------------------------------------------
*/

import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'

/**
 * Password-reset emails are queued in memory (`mail.sendLater`) so the
 * "forgot password" response never waits for SMTP. A failure there has no
 * caller to report to: log it (no recipient, no body — it holds the link).
 */
emitter.on('queued:mail:error', ({ error, mailerName }) => {
  logger.error({ err: error, mailer: mailerName }, 'queued email failed')
})
