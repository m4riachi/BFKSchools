import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import { dbAssertions } from '@adonisjs/lucid/plugins/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { authApiClient } from '@adonisjs/auth/plugins/api_client'
import { shieldApiClient } from '@adonisjs/shield/plugins/api_client'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'
import { inertiaApiClient } from '@adonisjs/inertia/plugins/api_client'
import { SessionGuard } from '@adonisjs/auth/session'
import {
  CREDENTIALS_SESSION_KEY,
  SESSION_ISSUED_KEY,
  SESSION_SEEN_KEY,
} from '#support/login_session'
import Clock from '#services/clock'

/**
 * `client.loginAs(user)` builds the session with the guard's
 * `authenticateAsClient`, which only stores the user id. Real logins also
 * bind the session to the user's credentials version (startUserSession) and
 * EnsureActiveUserMiddleware ends sessions without it (and without the
 * session timestamps, set from the Clock), so add them here: the
 * version of the user object passed to loginAs (a stale object = a session
 * started before a password change). It is applied after `.withSession()`.
 */
const authenticateAsClient = SessionGuard.prototype.authenticateAsClient
SessionGuard.prototype.authenticateAsClient = async function (user: any) {
  const result = await authenticateAsClient.call(this, user)
  // Session start = "now" of the (possibly frozen) Clock, like a real login.
  const clock = await app.container.make(Clock)
  const now = clock.now().toMillis()
  return {
    ...result,
    session: {
      ...result.session,
      [CREDENTIALS_SESSION_KEY]: user.credentialsVersion ?? 0,
      [SESSION_ISSUED_KEY]: now,
      [SESSION_SEEN_KEY]: now,
    },
  }
}

/**
 * Tests run against the `bfk_test` database (.env.test), with the memory
 * session store, the memory limiter store and the fake mailer.
 */
export const plugins: Config['plugins'] = [
  assert(),
  pluginAdonisJS(app),
  dbAssertions(app),
  apiClient(),
  sessionApiClient(app),
  shieldApiClient(),
  authApiClient(app),
  inertiaApiClient(app),
]

export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [() => testUtils.db().migrate()],
  teardown: [],
}

export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    return suite.setup(() => testUtils.httpServer().start())
  }
}
