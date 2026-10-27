import logger from '@adonisjs/core/services/logger'
import { JSONTransport } from '@adonisjs/mail/transports/json'
import type { MailTransportContract, NodeMailerMessage } from '@adonisjs/mail/types'

/**
 * Development transport used when no SMTP server (Mailpit) is available.
 * It renders the message with nodemailer's JSON transport and writes the
 * recipients, subject and text body to the application log.
 */
export class LogTransport implements MailTransportContract {
  #json = new JSONTransport()

  async send(message: NodeMailerMessage) {
    const response = await this.#json.send(message)
    logger.info(
      { to: message.to, subject: message.subject, text: message.text },
      'mail (log transport)'
    )
    return response
  }
}
