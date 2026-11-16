import { Exception } from '@adonisjs/core/exceptions'

/**
 * D59: valid credentials of a parent who signed up on the QR form and is
 * still waiting for the school (`registration_status = pending`).
 */
export default class PendingRegistrationException extends Exception {
  static status = 403
  static code = 'E_PENDING_REGISTRATION'
}
