/*
|--------------------------------------------------------------------------
| Rate limiters
|--------------------------------------------------------------------------
*/

import limiter from '@adonisjs/limiter/services/main'

/**
 * Login attempts: 5 failures per minute for the same email + IP, then the
 * key is blocked for 20 minutes. A successful login resets the counter.
 */
export function loginLimiter() {
  return limiter.use({ requests: 5, duration: '1 min', blockDuration: '20 mins' })
}

/**
 * Generic throttle middleware for sensitive public endpoints.
 */
export const throttle = limiter.define('global', () => {
  return limiter.allowRequests(10).every('1 minute')
})
