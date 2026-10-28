import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type User from '#models/user'
import OrderCancellationService from '#services/order_cancellation_service'
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
@inject()
export default class SubscriptionService {
  constructor(protected cancellations: OrderCancellationService) {}

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

  /**
   * Updates a period. When it ends earlier, is paused or ended, future
   * orders on dates no longer covered lose their subscription meal (D2;
   * emptied orders are cancelled) — same transaction, child row locked.
   */
  async update(subscription: Subscription, input: SubscriptionInput, actor: User | null = null) {
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
      await this.cancellations.trimUncoveredSubscriptionMeals(client, subscription.childId, actor)
      return subscription
    })
  }

  async delete(subscription: Subscription, actor: User | null = null) {
    await db.transaction(async (trx) => {
      await this.lockChild(subscription.childId, trx)
      subscription.useTransaction(trx)
      await subscription.delete()
      await this.cancellations.trimUncoveredSubscriptionMeals(trx, subscription.childId, actor)
    })
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

  /**
   * Locks the child's school `FOR SHARE`, then the child `FOR UPDATE` — the
   * same order as OrderService, ChildService and the holiday writes.
   */
  protected async lockChild(childId: number, client: TransactionClientContract) {
    const head = await client.from('children').where('id', childId).select('school_id').first()
    if (head) await client.from('schools').where('id', head.school_id).forShare().select('id')
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
