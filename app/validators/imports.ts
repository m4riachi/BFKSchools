import vine from '@vinejs/vine'
import { CSV_IMPORT_MAX_BYTES } from '#services/family_import_service'

/** Step 1: upload the CSV file. */
export const importUploadValidator = vine.create({
  file: vine.file({ size: CSV_IMPORT_MAX_BYTES, extnames: ['csv', 'txt'] }),
})

/** Step 2: confirm a previewed import. */
export const importConfirmValidator = vine.create({
  importId: vine.string().uuid({ version: [4] }),
  sendInvitations: vine.boolean().optional(),
})
