import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Child from '#models/child'
import Subscription from '#models/subscription'
import BusinessRuleException from '#exceptions/business_rule_exception'
import type { SubscriptionStatus } from '#enums/subscriptions'

export type SubscriptionInput = {
  startDate: string
  endDate?: string | null
  status: SubscriptionStatus
  notes?: string | null
}

/** PostgreSQL exclusion_violation (subscriptions_no_overlap). */
const EXCLUSION_VIOLATION = '23P01'

/**
 * Subscription periods of a child. Periods never overlap: checked here under
 * a lock on the child row (friendly error), and by the exclusion constraint
 * (race-proof).
 */
export default class SubscriptionService {
  async create(child: Child, input: SubscriptionInput, trx?: TransactionClientContract) {
    return this.run(trx, async (client) => {
      this.assertDates(input)
      await this.lockChild(child.id, client)
      await this.assertNoOverlap(child.id, input, client)
      return Subscription.create(
        {
          childId: child.id,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          status: input.status,
          notes: input.notes ?? null,
        },
        { client }
      )
    })
  }

  async update(subscription: Subscription, input: SubscriptionInput) {
    return this.run(undefined, async (client) => {
      this.assertDates(input)
      await this.lockChild(subscription.childId, client)
      await this.assertNoOverlap(subscription.childId, input, client, subscription.id)
      subscription.useTransaction(client)
      subscription.merge({
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        status: input.status,
        notes: input.notes ?? null,
      })
      await subscription.save()
      return subscription
    })
  }

  async delete(subscription: Subscription) {
    await subscription.delete()
  }

  /** Periods of `childId` that overlap [start, end] (end null = open-ended). */
  overlapping(
    childId: number,
    period: { startDate: string; endDate?: string | null },
    client?: TransactionClientContract,
    exceptId?: number
  ) {
    const query = Subscription.query(client ? { client } : {}).where('child_id', childId)
    if (period.endDate) {
      query.whereRaw(`daterange(start_date, end_date, '[]') && daterange(?::date, ?::date, '[]')`, [
        period.startDate,
        period.endDate,
      ])
    } else {
      query.whereRaw(`daterange(start_date, end_date, '[]') && daterange(?::date, NULL, '[]')`, [
        period.startDate,
      ])
    }
    if (exceptId) query.whereNot('id', exceptId)
    return query
  }

  protected assertDates(input: SubscriptionInput) {
    if (input.endDate && input.endDate < input.startDate) {
      throw new BusinessRuleException('families.errors.subscription_end_before_start', {
        field: 'endDate',
      })
    }
  }

  protected async lockChild(childId: number, client: TransactionClientContract) {
    await Child.query({ client }).where('id', childId).forUpdate().firstOrFail()
  }

  protected async assertNoOverlap(
    childId: number,
    input: SubscriptionInput,
    client: TransactionClientContract,
    exceptId?: number
  ) {
    const clash = await this.overlapping(childId, input, client, exceptId).first()
    if (clash) {
      throw new BusinessRuleException('families.errors.subscription_overlap', {
        field: 'startDate',
        values: { start: clash.startDate, end: clash.endDate ?? '…' },
      })
    }
  }

  protected async run<T>(
    trx: TransactionClientContract | undefined,
    callback: (client: TransactionClientContract) => Promise<T>
  ): Promise<T> {
    try {
      return trx ? await callback(trx) : await db.transaction(callback)
    } catch (error) {
      if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
        throw new BusinessRuleException('families.errors.subscription_overlap_generic', {
          field: 'startDate',
        })
      }
      throw error
    }
  }
}
