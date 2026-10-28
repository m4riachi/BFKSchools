import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, services } from '@adonisjs/drive'
import { readStorageEnv, s3DriverSettings } from '#support/storage_origin'

/**
 * File storage for meal photos (docs/ERD.md §meal_photos, `disk` column).
 *
 * - `fs`: local disk under `storage/` (dev/test). `serveFiles` is OFF: no
 *   route exposes the folder; photos are streamed by MediaController
 *   (`/media/meal-photos/:id/:variant`, logged-in users only, fixed
 *   `image/webp` content type).
 * - `s3`: any S3-compatible bucket. Keep the bucket private: MediaController
 *   redirects to short-lived signed URLs. `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE`
 *   cover Cloudflare R2 / MinIO / Scaleway… (`S3_REGION=auto` for R2;
 *   R2 also needs `supportsACL: false`, set by `s3EndpointOptions()`).
 *
 * The S3 client is only created when the `s3` disk is used, so dev/test run
 * without S3 variables (start/env.ts requires them when DRIVE_DISK=s3).
 */

const driveConfig = defineConfig({
  default: env.get('DRIVE_DISK'),

  services: {
    fs: services.fs({
      location: app.makePath('storage'),
      serveFiles: false,
      visibility: 'private',
    }),
    s3: services.s3({
      credentials: {
        accessKeyId: env.get('S3_ACCESS_KEY_ID') ?? '',
        secretAccessKey: env.get('S3_SECRET_ACCESS_KEY')?.release() ?? '',
      },
      visibility: 'private',
      // region, bucket, endpoint: same settings as the CSP img-src
      // (config/shield.ts → s3PublicOrigin), so the two cannot drift.
      ...s3DriverSettings(readStorageEnv(env)),
    }),
  },
})

export default driveConfig

declare module '@adonisjs/drive/types' {
  export interface DriveDisks extends InferDriveDisks<typeof driveConfig> {}
}
