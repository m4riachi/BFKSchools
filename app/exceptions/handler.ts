import app from '@adonisjs/core/services/app'
import { errors as bouncerErrors } from '@adonisjs/bouncer'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import type { StatusPageRange, StatusPageRenderer } from '@adonisjs/core/types/http'

export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction

  protected renderStatusPages = app.inProduction

  protected statusPages: Record<StatusPageRange, StatusPageRenderer> = {
    '404': (_, { inertia }) => inertia.render('errors/not_found', {}),
    '500..599': (_, { inertia }) => inertia.render('errors/server_error', {}),
  }

  async handle(error: unknown, ctx: HttpContext) {
    /**
     * Page visits denied by Bouncer or the role middleware get a real 403
     * Inertia page (Bouncer's own handler only sends plain text for GET).
     * Form submissions keep Bouncer's behaviour: flash + redirect back.
     */
    if (
      error instanceof bouncerErrors.E_AUTHORIZATION_FAILURE &&
      ['GET', 'HEAD'].includes(ctx.request.method()) &&
      ctx.request.accepts(['html', 'json']) !== 'json'
    ) {
      const page = await ctx.inertia.render('errors/forbidden', {})
      return ctx.response.status(403).send(page)
    }

    return super.handle(error, ctx)
  }

  /**
   * PostgreSQL errors carry the offending values in `detail` / `where`
   * (e.g. `Key (lower(email))=(salma@example.test) already exists`) and
   * knex adds the query bindings: never write those to the log (security
   * review L2). The error keeps its message, code, constraint and table.
   */
  async report(error: unknown, ctx: HttpContext) {
    stripDatabaseDetails(error)
    return super.report(error, ctx)
  }
}

const SENSITIVE_DB_FIELDS = ['detail', 'where', 'hint', 'internalQuery', 'parameters', 'bindings']

export function stripDatabaseDetails(error: unknown) {
  if (!error || typeof error !== 'object') return
  const target = error as Record<string, unknown>
  for (const field of SENSITIVE_DB_FIELDS) {
    if (field in target) delete target[field]
  }
  if (target.cause && target.cause !== error) stripDatabaseDetails(target.cause)
}
