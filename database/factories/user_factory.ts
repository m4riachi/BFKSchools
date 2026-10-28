import { randomUUID } from 'node:crypto'
import factory from '@adonisjs/lucid/factories'
import User from '#models/user'
import { ChildFactory } from '#database/factories/child_factory'

let sequence = 0

/**
 * Users for tests. Default password: "secret-password".
 * States: admin, manager, kitchen, parent, inactive, invited (no password).
 * Relation: children (`UserFactory.with('children', 2, (c) => c.merge({ schoolId }))`).
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
      credentialsVersion: 0,
    }
  })
  .state('admin', (user) => (user.role = 'admin'))
  .state('manager', (user) => (user.role = 'manager'))
  .state('kitchen', (user) => (user.role = 'kitchen'))
  .state('parent', (user) => (user.role = 'parent'))
  .state('inactive', (user) => (user.isActive = false))
  .state('invited', (user) => (user.password = null))
  .relation('children', () => ChildFactory)
  .build()
