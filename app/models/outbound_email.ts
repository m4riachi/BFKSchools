import { OutboundEmailSchema } from '#database/schema'

/**
 * A queued email (D16 outbox). Written by OutboxService.enqueue, sent by
 * `node ace mail:dispatch`. `toEmail` is never logged unmasked.
 */
export default class OutboundEmail extends OutboundEmailSchema {}
