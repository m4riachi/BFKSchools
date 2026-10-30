import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import RevenueService from '#services/revenue_service'
import { revenueQueryValidator } from '#validators/api'

/** External API (D36), school and keys checked by ApiKeyMiddleware. */
@inject()
export default class RevenueController {
  constructor(protected revenue: RevenueService) {}

  async daily({ request, response, apiSchool }: HttpContext) {
    const [invalid, query] = await revenueQueryValidator.tryValidate(request.qs())
    const period = invalid
      ? { error: 'Dates must be real dates written YYYY-MM-DD.' }
      : this.revenue.period(query)
    if ('error' in period) {
      return response.unprocessableEntity({
        error: { code: 'invalid_query', message: period.error },
      })
    }
    return this.revenue.daily(apiSchool, period.from, period.to)
  }
}
