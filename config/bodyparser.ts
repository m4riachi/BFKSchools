import { defineConfig } from '@adonisjs/core/bodyparser'
import { uploadTmpFileName } from '#support/uploads'

const bodyParserConfig = defineConfig({
  /**
   * Parse request bodies for these HTTP methods.
   * Keep this aligned with methods that receive payloads in your routes.
   */
  allowedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],

  /**
   * Config for the "application/x-www-form-urlencoded"
   * content-type parser.
   */
  form: {
    /**
     * Normalize empty string values to null.
     */
    convertEmptyStringsToNull: true,

    /**
     * Content types handled by the form parser.
     */
    types: ['application/x-www-form-urlencoded'],
  },

  /**
   * Config for the JSON parser.
   */
  json: {
    /**
     * Normalize empty string values to null.
     */
    convertEmptyStringsToNull: true,

    /**
     * Content types handled by the JSON parser.
     */
    types: [
      'application/json',
      'application/json-patch+json',
      'application/vnd.api+json',
      'application/csp-report',
    ],
  },

  /**
   * Config for the "multipart/form-data" content-type parser.
   * File uploads are handled by the multipart parser.
   */
  multipart: {
    /**
     * Files are written to disk ONLY for the two import routes (the
     * bodyparser runs before auth/CSRF: auto-processing every route let any
     * anonymous multipart POST, e.g. to /login, drop files on the disk).
     * Every other route leaves a multipart body unparsed. Temporary files go
     * to tmp/uploads and are deleted at the end of each request by
     * UploadCleanupMiddleware (start/kernel.ts), whatever the outcome.
     */
    autoProcess: ['/admin/imports/families', '/admin/holidays/import'],
    tmpFileName: uploadTmpFileName,

    /**
     * Normalize empty string values to null.
     */
    convertEmptyStringsToNull: true,

    /**
     * Routes where multipart processing is handled manually.
     * - meal photo upload: MealPhotosController buffers the files in memory
     *   with per-file and per-route limits (MEAL_PHOTOS in config/meals.ts).
     */
    processManually: ['/admin/meals/:id/photos'],

    /**
     * Maximum multipart payload of the auto-processed routes (CSV and ICS
     * files are capped at 1 MB by their validators; 413 above this).
     */
    limit: '2mb',

    /**
     * Content types handled by the multipart parser.
     */
    types: ['multipart/form-data'],
  },
})

export default bodyParserConfig
