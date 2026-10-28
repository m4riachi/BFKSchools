/*
|--------------------------------------------------------------------------
| Event listeners
|--------------------------------------------------------------------------
*/

import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'

/**
 * Any email queued in memory with `mail.sendLater` has no caller to report
 * a failure to: log it (no recipient, no body — it may hold a link).
 * (Password-reset emails no longer use it: they are sent with `mail.send`
 * from DeferredTasks, after the response.)
 */
emitter.on('queued:mail:error', ({ error, mailerName }) => {
  logger.error({ err: error, mailer: mailerName }, 'queued email failed')
})
