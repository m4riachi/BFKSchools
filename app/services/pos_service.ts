import Child from '#models/child'
import type School from '#models/school'
import User from '#models/user'

const MAX_PARENTS = 20

/**
 * Staff ordering desk (D39): finds the families of a school. Orders themselves
 * go through OrderService, like every other order.
 */
export default class PosService {
  /** Active parents with active children, by parent name, phone, email or child name. */
  async searchFamilies(school: School, search?: string) {
    const parents = await User.query()
      .where('school_id', school.id)
      .where('role', 'parent')
      .where('is_active', true)
      .whereExists((children) =>
        children
          .from('children as c')
          .whereColumn('c.parent_id', 'users.id')
          .where('c.is_active', true)
      )
      .if(search, (query) => {
        const pattern = `%${search!.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
        query.where((match) =>
          match
            .whereILike('full_name', pattern)
            .orWhereILike('email', pattern)
            .orWhereILike('phone', pattern)
            .orWhereExists((children) =>
              children
                .from('children as c')
                .whereColumn('c.parent_id', 'users.id')
                .where((name) =>
                  name.whereILike('c.first_name', pattern).orWhereILike('c.last_name', pattern)
                )
            )
        )
      })
      .orderBy('full_name')
      .limit(MAX_PARENTS)

    const children = parents.length
      ? await Child.query()
          .whereIn(
            'parent_id',
            parents.map((parent) => parent.id)
          )
          .where('is_active', true)
          .orderBy('first_name')
      : []
    return parents.map((parent) => ({
      id: parent.id,
      fullName: parent.fullName,
      phone: parent.phone,
      children: children
        .filter((child) => child.parentId === parent.id)
        .map((child) => ({
          id: child.id,
          firstName: child.firstName,
          lastName: child.lastName,
          grade: child.grade,
          className: child.className,
        })),
    }))
  }
}
