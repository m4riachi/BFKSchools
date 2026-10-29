import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/** 180 days, like Shield's HSTS setting (config/shield.ts). */
const HSTS = 'max-age=15552000'

/**
 * Server-level middleware (start/kernel.ts `server.use`): runs for every
 * response, including unmatched routes (404) and errors raised before the
 * router middleware (e.g. the CSRF failure redirect), where Shield — a
 * router middleware — never ran. Sets the static headers here; Shield still
 * sets the same values on routed requests, plus the nonce-based CSP.
 */
export default class SecurityHeadersMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const { response } = ctx
    response.header('X-Frame-Options', 'DENY')
    response.header('X-Content-Type-Options', 'nosniff')
    response.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    response.header('Cross-Origin-Opener-Policy', 'same-origin')
    if (app.inProduction) response.header('Strict-Transport-Security', HSTS)
    return next()
  }
}
