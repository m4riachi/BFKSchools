import type User from '#models/user'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * The authenticated user as shared with every Inertia page.
 * Never add the password or tokens here.
 */
export default class UserTransformer extends BaseTransformer<User> {
  toObject() {
    return this.pick(this.resource, ['id', 'fullName', 'email', 'role', 'locale', 'initials'])
  }
}
