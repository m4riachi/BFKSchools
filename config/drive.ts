import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, services } from '@adonisjs/drive'

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
 *   R2 also needs `supportsACL: false`, set below when an endpoint is used).
 *
 * The S3 client is only created when the `s3` disk is used, so dev/test run
 * without S3 variables (start/env.ts requires them when DRIVE_DISK=s3).
 */
const s3Endpoint = env.get('S3_ENDPOINT')

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
      region: env.get('S3_REGION') ?? 'auto',
      bucket: env.get('S3_BUCKET') ?? '',
      visibility: 'private',
      ...(s3Endpoint
        ? {
            endpoint: s3Endpoint,
            forcePathStyle: env.get('S3_FORCE_PATH_STYLE') ?? false,
            supportsACL: false,
          }
        : {}),
    }),
  },
})

export default driveConfig

declare module '@adonisjs/drive/types' {
  export interface DriveDisks extends InferDriveDisks<typeof driveConfig> {}
}
