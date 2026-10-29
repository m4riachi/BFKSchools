import type { ApplicationService } from '@adonisjs/core/types'
import DeferredTasks from '#services/deferred_tasks'

/**
 * Application-wide singletons (other than the Clock, see time_provider).
 */
export default class AppServicesProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(DeferredTasks, () => new DeferredTasks())
  }

  /**
   * Production web server with DRIVE_DISK=s3: presign a dummy key (local
   * computation, no network) and refuse to start when its origin is not
   * the one the CSP img-src allows — otherwise every meal photo would be
   * blocked by the browser after the redirect (docs/STACK_NOTES.md, S3 CSP).
   */
  async ready() {
    if (!this.app.inProduction || this.app.getEnvironment() !== 'web') return
    const { default: env } = await import('#start/env')
    if (env.get('DRIVE_DISK') !== 's3') return
    const { default: drive } = await import('@adonisjs/drive/services/main')
    const { readStorageEnv, signedUrlOriginMismatch } = await import('#support/storage_origin')
    const signed = await drive.use('s3').getSignedUrl('_boot-check/presign-probe.webp', {
      expiresIn: '1 min',
    })
    const mismatch = signedUrlOriginMismatch(signed, readStorageEnv(env))
    if (mismatch) throw new Error(`S3 storage self-check failed: ${mismatch}`)
  }

  /** Let deferred work (e.g. password-reset emails) finish on a graceful shutdown (bounded). */
  async shutdown() {
    const tasks = await this.app.container.make(DeferredTasks)
    await tasks.drain()
  }
}
