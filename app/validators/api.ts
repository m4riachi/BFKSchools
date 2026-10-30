import vine from '@vinejs/vine'
import { isoDateRule } from '#validators/rules'

/** Query string of GET /api/v1/revenue/daily. */
export const revenueQueryValidator = vine.create({
  date: isoDateRule().optional(),
  from: isoDateRule().optional(),
  to: isoDateRule().optional(),
})
