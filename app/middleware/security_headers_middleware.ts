import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Headers Shield does not set: referrer and permissions policies.
 * (Shield handles CSRF, CSP, HSTS, X-Frame-Options and nosniff.)
 */
export default class SecurityHeadersMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    ctx.response.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    ctx.response.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()'
    )
    ctx.response.header('Cross-Origin-Opener-Policy', 'same-origin')
    return next()
  }
}
