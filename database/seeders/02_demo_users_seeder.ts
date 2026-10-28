import { BaseSeeder } from '@adonisjs/lucid/seeders'
import School from '#models/school'
import User from '#models/user'
import type { Role } from '#enums/roles'
import type { AppLocale } from '#enums/locales'

/**
 * One demo account per role (development only). All use the same password.
 */
export const DEMO_PASSWORD = 'Demo1234!'

export const DEMO_USERS: { email: string; fullName: string; role: Role; locale: AppLocale }[] = [
  { email: 'admin@bfk.test', fullName: 'Nadia Lahlou', role: 'admin', locale: 'fr' },
  { email: 'manager@bfk.test', fullName: 'Karim Bennani', role: 'manager', locale: 'fr' },
  { email: 'kitchen@bfk.test', fullName: 'Youssef Amrani', role: 'kitchen', locale: 'fr' },
  { email: 'parent@bfk.test', fullName: 'Salma Idrissi', role: 'parent', locale: 'en' },
]

export default class DemoUsersSeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    const school = await School.findByOrFail('slug', 'britech-school')

    for (const demo of DEMO_USERS) {
      const user = (await User.findByEmail(demo.email)) ?? new User()
      user.merge({
        ...demo,
        password: DEMO_PASSWORD,
        isActive: true,
        // Phase 2: parents must belong to a school, and staff only manage
        // families of their own school (null never means "all schools").
        schoolId: school.id,
      })
      await user.save()
    }
  }
}
