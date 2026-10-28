import { inject } from '@adonisjs/core'
import hash from '@adonisjs/core/services/hash'
import { errors as authErrors } from '@adonisjs/auth'
import User from '#models/user'
import Clock from '#services/clock'
import InactiveAccountException from '#exceptions/inactive_account_exception'

@inject()
export default class LoginService {
  constructor(protected clock: Clock) {}

  /**
   * Checks email + password. Unknown emails and users without a password
   * (invitation not accepted yet) still run a hash, so response time does
   * not reveal whether an account exists.
   *
   * `preloaded` is the user row already looked up for `email` (the login
   * controller needs it for the known-device check); omit it to look it up.
   *
   * @throws E_INVALID_CREDENTIALS | InactiveAccountException
   */
  async verifyCredentials(email: string, password: string, preloaded?: User | null): Promise<User> {
    const user = preloaded === undefined ? await User.findByEmail(email) : preloaded

    if (!user || !user.password) {
      await hash.make(password)
      throw new authErrors.E_INVALID_CREDENTIALS('Invalid user credentials')
    }

    if (!(await hash.verify(user.password, password))) {
      throw new authErrors.E_INVALID_CREDENTIALS('Invalid user credentials')
    }

    if (!user.isActive) {
      throw new InactiveAccountException('Account is inactive')
    }

    return user
  }

  findUser(email: string) {
    return User.findByEmail(email)
  }

  async recordLogin(user: User) {
    user.lastLoginAt = this.clock.now()
    await user.save()
  }
}
