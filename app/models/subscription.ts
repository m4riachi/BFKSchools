import { SubscriptionSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Child from '#models/child'

/**
 * A subscription period of a child. Dates are 'YYYY-MM-DD' strings;
 * `endDate` null = open-ended. Only `active` periods cover a day (D2:
 * subscription meals need an active subscription). Periods of one child
 * never overlap (exclusion constraint + SubscriptionService check).
 */
export default class Subscription extends SubscriptionSchema {
  @belongsTo(() => Child)
  declare child: BelongsTo<typeof Child>

  /** True when this period is active and covers `date` ('YYYY-MM-DD'). */
  covers(date: string) {
    return (
      this.status === 'active' &&
      this.startDate <= date &&
      (this.endDate === null || this.endDate >= date)
    )
  }
}
