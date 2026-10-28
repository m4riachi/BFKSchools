import mail from '@adonisjs/mail/services/main'
import type { BaseMail } from '@adonisjs/mail'

/**
 * The one place the outbox hands a mail to the mailer. A class so tests can
 * swap it (`app.container.swap(OutboxSender, …)`) to simulate SMTP failures.
 */
export default class OutboxSender {
  async send(message: BaseMail): Promise<void> {
    await mail.send(message)
  }
}
