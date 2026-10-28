import type User from '#models/user'
import Child from '#models/child'
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
export default class ChildService {
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

  async update(child: Child, input: ChildInput): Promise<Child> {
    child.merge({ ...this.attributes(input), isActive: input.isActive ?? child.isActive })
    return this.guardUnique(() => child.save())
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
