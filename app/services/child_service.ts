import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type User from '#models/user'
import Child from '#models/child'
import OrderCancellationService from '#services/order_cancellation_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import type { AllergenCode } from '#enums/allergens'

export type ChildInput = {
  firstName: string
  lastName: string
  grade?: string | null
  className?: string | null
  allergies?: AllergenCode[]
  dietaryNotes?: string | null
  isActive?: boolean
}

/** PostgreSQL unique_violation / foreign_key_violation. */
const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

/**
 * Children of a parent. The child's school is the parent's school.
 */
@inject()
export default class ChildService {
  constructor(protected cancellations: OrderCancellationService) {}

  async create(parent: User, input: ChildInput): Promise<Child> {
    const schoolId = parent.schoolId
    if (parent.role !== 'parent' || typeof schoolId !== 'number') {
      throw new BusinessRuleException('families.errors.not_a_parent')
    }
    return this.guardUnique(() =>
      Child.create({
        parentId: parent.id,
        schoolId,
        ...this.attributes(input),
        isActive: input.isActive ?? true,
      })
    )
  }

  /**
   * Updates a child. Deactivating it cancels its future active orders
   * (`child_inactive`, audited as `actor`, parent notified) in the same
   * transaction, with the child row locked first (same order as orders).
   * Re-activating restores nothing.
   */
  async update(child: Child, input: ChildInput, actor: User | null = null): Promise<Child> {
    return this.guardUnique(() =>
      db.transaction(async (trx) => {
        await trx.from('schools').where('id', child.schoolId).forShare().select('id')
        const locked = await Child.query({ client: trx })
          .where('id', child.id)
          .forUpdate()
          .firstOrFail()
        const wasActive = locked.isActive
        child.useTransaction(trx)
        child.merge({ ...this.attributes(input), isActive: input.isActive ?? child.isActive })
        await child.save()
        if (wasActive && !child.isActive) {
          await this.cancellations.cancelFutureOrders(trx, [child.id], actor)
        }
        return child
      })
    )
  }

  /**
   * Deletes a child and its subscription periods. Children referenced by
   * orders (Phase 6, FK RESTRICT) must be deactivated instead.
   */
  async delete(child: Child) {
    try {
      await child.delete()
    } catch (error) {
      if ((error as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
        throw new BusinessRuleException('families.errors.child_has_orders')
      }
      throw error
    }
  }

  protected attributes(input: ChildInput) {
    return {
      firstName: input.firstName,
      lastName: input.lastName,
      grade: input.grade ?? null,
      className: input.className ?? null,
      allergies: [...new Set(input.allergies ?? [])],
      dietaryNotes: input.dietaryNotes ?? null,
    }
  }

  protected async guardUnique<T>(callback: () => Promise<T>): Promise<T> {
    try {
      return await callback()
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new BusinessRuleException('families.errors.child_duplicate', { field: 'firstName' })
      }
      throw error
    }
  }
}
