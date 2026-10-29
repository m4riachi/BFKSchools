import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'

/**
 * Folder of the bodyparser's temporary upload files (`tmp/uploads`, inside
 * the app — never the shared OS temp dir). Only the two import routes are
 * auto-processed (config/bodyparser.ts) and UploadCleanupMiddleware deletes
 * every file at the end of the request, whatever happened.
 */
let ready: string | null = null
export function uploadTmpDir(): string {
  if (!ready) {
    ready = app.tmpPath('uploads')
    mkdirSync(ready, { recursive: true, mode: 0o700 })
  }
  return ready
}

/** `multipart.tmpFileName` of config/bodyparser.ts. */
export function uploadTmpFileName(): string {
  return join(uploadTmpDir(), randomUUID())
}
