import { BaseSeeder } from '@adonisjs/lucid/seeders'
import School from '#models/school'
import User from '#models/user'
import Child from '#models/child'
import Subscription from '#models/subscription'

/**
 * Two children for the demo parent (development/test only). Idempotent.
 * Realistic family data (15 parents…) comes with the Phase 9 seeders.
 */
export default class DemoFamilySeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    const school = await School.findByOrFail('slug', 'britech-school')
    const parent = await User.findByEmail('parent@bfk.test')
    if (!parent) return

    const children = [
      {
        firstName: 'Adam',
        lastName: 'Idrissi',
        grade: 'G3',
        className: '3B',
        allergies: ['gluten'] as const,
      },
      {
        firstName: 'Lina',
        lastName: 'Idrissi',
        grade: 'KG2',
        className: 'KG2-A',
        allergies: [] as const,
      },
    ]

    for (const data of children) {
      const child =
        (await Child.query()
          .where('parent_id', parent.id)
          .whereRaw('lower(first_name) = ?', [data.firstName.toLowerCase()])
          .first()) ?? new Child()
      child.merge({
        ...data,
        allergies: [...data.allergies],
        parentId: parent.id,
        schoolId: school.id,
        isActive: true,
      })
      await child.save()

      const hasPeriod = await Subscription.query().where('child_id', child.id).first()
      if (!hasPeriod) {
        await Subscription.create({
          childId: child.id,
          startDate: school.schoolYearStart,
          endDate: school.schoolYearEnd,
          status: 'active',
        })
      }
    }
  }
}
