import { readFile, rm } from 'node:fs/promises'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import FamilyImportService, {
  CSV_COLUMNS,
  ImportInvalidError,
  CSV_IMPORT_MAX_ROWS,
} from '#services/family_import_service'
import ImportStore from '#services/import_store'
import { importConfirmValidator, importUploadValidator } from '#validators/imports'
import { staffSchoolId } from '#policies/parent_policy'
import { ALLERGENS } from '#enums/allergens'

/**
 * CSV import of families: upload → preview (row-level errors, nothing
 * saved) → confirm (one transaction) → optional invitations.
 */
@inject()
export default class FamilyImportsController {
  constructor(
    protected imports: FamilyImportService,
    protected store: ImportStore
  ) {}

  async create({ inertia, bouncer }: HttpContext) {
    await bouncer.with('ParentPolicy').authorize('import')
    return inertia.render('admin/imports/families', {
      importId: null,
      plan: null,
      columns: [...CSV_COLUMNS],
      allergens: [...ALLERGENS],
      maxRows: CSV_IMPORT_MAX_ROWS,
    })
  }

  async template({ response, bouncer }: HttpContext) {
    await bouncer.with('ParentPolicy').authorize('import')
    response.header('content-type', 'text/csv; charset=utf-8')
    response.attachment('bfk-families-template.csv')
    return response.send(`${String.fromCodePoint(0xfeff)}${this.imports.template()}`)
  }

  /** Stores the upload, then shows its preview. */
  async upload({ request, response, bouncer, auth }: HttpContext) {
    await bouncer.with('ParentPolicy').authorize('import')
    const user = auth.getUserOrFail()
    const { file } = await request.validateUsing(importUploadValidator)

    let content: string
    try {
      content = await readFile(file.tmpPath!, 'utf8')
    } finally {
      // The bodyparser leaves uploads in the OS temp folder; the store keeps its own copy.
      await rm(file.tmpPath!, { force: true })
    }
    const id = await this.store.put(user.id, staffSchoolId(user)!, content)
    return response.redirect(`/admin/imports/families/${id}`)
  }

  /** Preview: re-checked against the database on every visit. */
  async show({ params, inertia, response, bouncer, auth, session, i18n }: HttpContext) {
    await bouncer.with('ParentPolicy').authorize('import')
    const user = auth.getUserOrFail()
    const schoolId = staffSchoolId(user)!
    const content = await this.store.get(String(params.id), user.id, schoolId)
    if (content === null) {
      session.flash('error', i18n.t('families.import.expired'))
      return response.redirect('/admin/imports/families')
    }

    const plan = await this.imports.analyze(schoolId, content, i18n)
    return inertia.render('admin/imports/families', {
      importId: String(params.id),
      plan,
      columns: [...CSV_COLUMNS],
      allergens: [...ALLERGENS],
      maxRows: CSV_IMPORT_MAX_ROWS,
    })
  }

  async confirm({ params, request, response, bouncer, auth, session, i18n }: HttpContext) {
    await bouncer.with('ParentPolicy').authorize('import')
    const user = auth.getUserOrFail()
    const schoolId = staffSchoolId(user)!
    const { importId, sendInvitations } = await request.validateUsing(importConfirmValidator, {
      data: { ...request.body(), importId: params.id },
    })

    const content = await this.store.get(importId, user.id, schoolId)
    if (content === null) {
      session.flash('error', i18n.t('families.import.expired'))
      return response.redirect('/admin/imports/families')
    }

    try {
      const result = await this.imports.apply(schoolId, content, i18n, {
        sendInvitations: sendInvitations === true,
        staff: user,
      })
      await this.store.delete(importId)
      session.flash('success', i18n.t('families.import.done', { ...result }))
      if (result.invitationFailures > 0) {
        session.flash(
          'error',
          i18n.t('families.import.invitation_failures', { count: result.invitationFailures })
        )
      }
      return response.redirect('/admin/parents')
    } catch (error) {
      if (!(error instanceof ImportInvalidError)) throw error
      session.flash('error', i18n.t('families.import.no_longer_valid'))
      return response.redirect(`/admin/imports/families/${importId}`)
    }
  }
}
