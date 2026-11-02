import { TicketPrintJobSchema } from '#database/schema'

export type TicketPrintJobStatus = 'queued' | 'printing' | 'done' | 'failed'

/** D50: a print of the day's order tickets on the kitchen's receipt printer. */
export default class TicketPrintJob extends TicketPrintJobSchema {}
