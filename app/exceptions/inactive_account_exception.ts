import { Exception } from '@adonisjs/core/exceptions'

/**
 * Valid credentials but the account is deactivated (`users.is_active = false`).
 */
export default class InactiveAccountException extends Exception {
  static status = 403
  static code = 'E_INACTIVE_ACCOUNT'
}
