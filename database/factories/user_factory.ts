import { randomUUID } from 'node:crypto'
import factory from '@adonisjs/lucid/factories'
import User from '#models/user'

let sequence = 0

/**
 * Users for tests. Default password: "secret-password".
 * States: admin, manager, kitchen, parent, inactive.
 */
export const UserFactory = factory
  .define(User, () => {
    sequence += 1
    return {
      fullName: `Test User ${sequence}`,
      email: `user${sequence}-${randomUUID().slice(0, 8)}@example.test`,
      password: 'secret-password',
      role: 'parent' as const,
      locale: 'fr' as const,
      isActive: true,
      notificationPrefs: {},
    }
  })
  .state('admin', (user) => (user.role = 'admin'))
  .state('manager', (user) => (user.role = 'manager'))
  .state('kitchen', (user) => (user.role = 'kitchen'))
  .state('parent', (user) => (user.role = 'parent'))
  .state('inactive', (user) => (user.isActive = false))
  .build()
