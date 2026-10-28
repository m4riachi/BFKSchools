import logger from '@adonisjs/core/services/logger'
import { JSONTransport } from '@adonisjs/mail/transports/json'
import type { MailTransportContract, NodeMailerMessage } from '@adonisjs/mail/types'

type Recipient = string | { address: string; name?: string }

export interface LogTransportOptions {
  /**
   * Also log the text body. Development only: bodies carry invitation and
   * password-reset links. `config/mail.ts` forces it off in production
   * (where the log mailer is refused anyway, see start/env.ts).
   */
  logBody?: boolean
  /** Injected in tests; defaults to the application logger. */
  logger?: Pick<typeof logger, 'info'>
}

/**
 * Masks an email for logs: `salma.idrissi@example.test` → `s***@example.test`.
 */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@')
  if (at <= 0) return '***'
  return `${address[0]}***${address.slice(at)}`
}

function recipients(to: NodeMailerMessage['to']): string[] {
  const list = (Array.isArray(to) ? to : to ? [to] : []) as Recipient[]
  return list.map((entry) => maskEmail(typeof entry === 'string' ? entry : entry.address))
}

/**
 * Development transport used when no SMTP server (Mailpit) is available.
 * It renders the message with nodemailer's JSON transport and logs the
 * subject and masked recipients. The body is omitted unless `logBody`.
 */
export class LogTransport implements MailTransportContract {
  #json = new JSONTransport()
  #logBody: boolean
  #logger: Pick<typeof logger, 'info'>

  constructor(options: LogTransportOptions = {}) {
    this.#logBody = options.logBody === true
    this.#logger = options.logger ?? logger
  }

  async send(message: NodeMailerMessage) {
    const response = await this.#json.send(message)
    this.#logger.info(
      {
        to: recipients(message.to),
        subject: message.subject,
        ...(this.#logBody
          ? { text: message.text }
          : { body: 'omitted (set MAIL_LOG_BODY=true in development to log it)' }),
      },
      'mail (log transport)'
    )
    return response
  }
}
