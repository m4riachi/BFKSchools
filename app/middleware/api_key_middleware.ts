import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { errors as limiterErrors } from '@adonisjs/limiter'
import type School from '#models/school'
import ApiKeyService from '#services/api_key_service'
import { apiIpLimiter, apiKeys } from '#start/limiter'

/**
 * External API (D36): the X-Api-Key + X-Api-Secret pair identifies the school,
 * which then scopes every query. Headers only, so keys stay out of URL logs.
 */
@inject()
export default class ApiKeyMiddleware {
  constructor(protected keys: ApiKeyService) {}

  async handle(ctx: HttpContext, next: NextFn) {
    const { request, response } = ctx
    response.header('Cache-Control', 'no-store')
    try {
      await apiIpLimiter().consume(apiKeys.ip(request.ip()))
    } catch (error) {
      if (!(error instanceof limiterErrors.E_TOO_MANY_REQUESTS)) throw error
      response.header('Retry-After', String(error.response.availableIn))
      return response.tooManyRequests({
        error: { code: 'too_many_requests', message: 'Too many requests.' },
      })
    }

    const publicKey = request.header('x-api-key')
    const secret = request.header('x-api-secret')
    const school = publicKey && secret ? await this.keys.authenticate(publicKey, secret) : null
    if (!school) {
      return response.unauthorized({
        error: { code: 'invalid_api_key', message: 'Invalid or missing API keys.' },
      })
    }

    ctx.apiSchool = school
    return next()
  }
}

declare module '@adonisjs/core/http' {
  interface HttpContext {
    apiSchool: School
  }
}
