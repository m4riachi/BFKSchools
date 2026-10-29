import { rm } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

type FileLike = { tmpPath?: string }

/**
 * Router middleware placed BEFORE the bodyparser: once the request is
 * handled — success, validation error, 403, CSRF failure, anything thrown —
 * every temporary file the bodyparser wrote for it is deleted. Controllers
 * read uploads synchronously (CSV / ICS ≤ 1 MB) before answering.
 */
export default class UploadCleanupMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    try {
      return await next()
    } finally {
      if (ctx.request.bodyType === 'multipart') await removeUploads(ctx)
    }
  }
}

async function removeUploads(ctx: HttpContext) {
  const paths: string[] = []
  const collect = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') {
      const tmp = (value as FileLike).tmpPath
      if (typeof tmp === 'string') paths.push(tmp)
      else if (!('clientName' in value)) Object.values(value).forEach(collect)
    }
  }
  try {
    collect(ctx.request.allFiles())
  } catch {
    return
  }
  await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => {})))
}
