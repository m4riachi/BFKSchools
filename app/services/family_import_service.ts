import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import vine, { errors as vineErrors } from '@vinejs/vine'
import type { I18n } from '@adonisjs/i18n'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { parse } from 'csv-parse/sync'
import User from '#models/user'
import Child from '#models/child'
import Subscription from '#models/subscription'
import SubscriptionService from '#services/subscription_service'
import AccountLinkService from '#services/account_link_service'
import { ALLERGENS, isAllergenCode, type AllergenCode } from '#enums/allergens'
import type { AppLocale } from '#enums/locales'
import { emailRule, isoDateRule, nameRule, phoneRule } from '#validators/rules'

export const CSV_IMPORT_MAX_BYTES = '1mb'
const BOM = String.fromCodePoint(0xfeff)
export const CSV_IMPORT_MAX_ROWS = 2000

/** Columns of the import file, in template order. */
export const CSV_COLUMNS = [
  'parent_full_name',
  'parent_email',
  'parent_phone',
  'parent_locale',
  'child_first_name',
  'child_last_name',
  'grade',
  'class_name',
  'allergies',
  'subscription_start',
  'subscription_end',
] as const
type CsvColumn = (typeof CSV_COLUMNS)[number]
const REQUIRED_COLUMNS: CsvColumn[] = [
  'parent_full_name',
  'parent_email',
  'child_first_name',
  'child_last_name',
]

const rowValidator = vine.create({
  parent_full_name: nameRule(120),
  parent_email: emailRule(),
  parent_phone: phoneRule().optional(),
  parent_locale: vine.string().trim().toLowerCase().in(['fr', 'en']).optional(),
  child_first_name: nameRule(80),
  child_last_name: nameRule(80),
  grade: nameRule(40).optional(),
  class_name: nameRule(40).optional(),
  allergies: vine.string().trim().maxLength(500).optional(),
  subscription_start: isoDateRule().optional(),
  subscription_end: isoDateRule().optional(),
})

export type ImportAction = 'create' | 'update' | 'unchanged' | 'none'

/** One line of the preview table (already translated for the viewer). */
export type ImportPreviewRow = {
  line: number
  parentName: string
  email: string
  childName: string
  grade: string | null
  className: string | null
  allergies: string[]
  subscription: { start: string; end: string | null } | null
  parentAction: ImportAction
  childAction: ImportAction
  subscriptionAction: ImportAction
  errors: string[]
}

export type ImportPlan = {
  fileErrors: string[]
  rows: ImportPreviewRow[]
  summary: {
    rows: number
    invalidRows: number
    newParents: number
    updatedParents: number
    newChildren: number
    updatedChildren: number
    newSubscriptions: number
  }
  valid: boolean
}

export type ImportResult = {
  createdParents: number
  updatedParents: number
  createdChildren: number
  updatedChildren: number
  createdSubscriptions: number
  invited: number
  invitationFailures: number
}

type CleanRow = {
  fullName: string
  email: string
  phone: string | null
  locale: AppLocale | null
  firstName: string
  lastName: string
  grade: string | null
  className: string | null
  allergies: AllergenCode[]
  start: string | null
  end: string | null
}

type WorkRow = {
  line: number
  raw: Record<string, string>
  clean: CleanRow | null
  errors: string[]
  parentAction: ImportAction
  childAction: ImportAction
  subscriptionAction: ImportAction
}

export class ImportInvalidError extends Error {
  constructor(readonly plan: ImportPlan) {
    super('The import is no longer valid')
  }
}

function childKey(email: string, firstName: string, lastName: string) {
  return `${email}|${firstName.toLowerCase()}|${lastName.toLowerCase()}`
}

/**
 * CSV import of parents + children (+ one subscription period per row).
 *
 * upload → `analyze()` (nothing saved, row-level errors) → confirm →
 * `apply()` re-analyzes inside ONE transaction and saves everything or
 * nothing. Rows sharing an email belong to the same parent. Re-importing
 * the same file is idempotent: parents match by email, children by parent +
 * first name + last name (case-insensitive), identical periods are skipped.
 * Allergies are only ever added by an import, never removed.
 */
@inject()
export default class FamilyImportService {
  constructor(
    protected subscriptions: SubscriptionService,
    protected accountLinks: AccountLinkService
  ) {}

  template(): string {
    const lines = [
      CSV_COLUMNS.join(','),
      'Salma Idrissi,salma.idrissi@example.com,+212612345678,fr,Adam,Idrissi,G3,3B,gluten;milk,2026-09-01,2027-06-11',
      'Salma Idrissi,salma.idrissi@example.com,+212612345678,fr,Lina,Idrissi,KG2,KG2-A,,2026-09-01,',
      'John Smith,john.smith@example.com,,en,Emma,Smith,G5,5A,peanuts;nuts,,',
    ]
    return `${lines.join('\r\n')}\r\n`
  }

  /**
   * Parses and checks a file against the database. Nothing is written.
   */
  async analyze(
    schoolId: number,
    content: string,
    i18n: I18n,
    client?: TransactionClientContract
  ): Promise<ImportPlan> {
    const { rows, fileErrors } = this.parse(content, i18n)
    if (fileErrors.length) return this.plan(rows, fileErrors)

    await this.validateRows(rows, i18n)
    this.checkFileConsistency(rows, i18n)
    await this.checkAgainstDatabase(schoolId, rows, i18n, client)
    return this.plan(rows, [])
  }

  /**
   * Saves a previously previewed file in one transaction. Throws
   * ImportInvalidError (with a fresh plan) if the file no longer validates.
   */
  async apply(
    schoolId: number,
    content: string,
    i18n: I18n,
    options: { sendInvitations: boolean; staff: User }
  ): Promise<ImportResult> {
    const result: ImportResult = {
      createdParents: 0,
      updatedParents: 0,
      createdChildren: 0,
      updatedChildren: 0,
      createdSubscriptions: 0,
      invited: 0,
      invitationFailures: 0,
    }

    const newParentIds = await db.transaction(async (trx) => {
      // Serialize concurrent imports of the same school.
      await trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [7301, schoolId])

      const { rows, fileErrors } = this.parse(content, i18n)
      await this.validateRows(rows, i18n)
      this.checkFileConsistency(rows, i18n)
      await this.checkAgainstDatabase(schoolId, rows, i18n, trx)
      const plan = this.plan(rows, fileErrors)
      if (!plan.valid) throw new ImportInvalidError(plan)

      return this.save(schoolId, rows, trx, result)
    })

    if (options.sendInvitations && newParentIds.length) {
      const parents = await User.query().whereIn('id', newParentIds).orderBy('id')
      for (const parent of parents) {
        try {
          await this.accountLinks.invite(parent, options.staff)
          result.invited++
        } catch (error) {
          result.invitationFailures++
          logger.error({ err: error, parentId: parent.id }, 'import: invitation failed')
        }
      }
    }
    return result
  }

  /** Splits the file into rows keyed by column name. */
  protected parse(content: string, i18n: I18n): { rows: WorkRow[]; fileErrors: string[] } {
    const t = (key: string, values?: Record<string, string | number>) =>
      i18n.t(`families.import.errors.${key}`, values ?? {})

    const text = content.startsWith(BOM) ? content.slice(1) : content
    const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
    if (!firstLine.trim()) return { rows: [], fileErrors: [t('empty_file')] }
    // Excel in French saves CSV with ";" — detect it from the header.
    const delimiter = !firstLine.includes(',') && firstLine.includes(';') ? ';' : ','

    let records: string[][]
    try {
      records = parse(text, {
        delimiter,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: false,
        trim: true,
        max_record_size: 10_000,
        to: CSV_IMPORT_MAX_ROWS + 2,
      }) as string[][]
    } catch (error) {
      const line = (error as { lines?: number }).lines
      return { rows: [], fileErrors: [t('invalid_csv', { line: line ?? '?' })] }
    }

    const header = (records.shift() ?? []).map((name) => name.trim().toLowerCase())
    const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column))
    const unknown = header.filter(
      (name) => name && !(CSV_COLUMNS as readonly string[]).includes(name)
    )
    const fileErrors: string[] = []
    if (missing.length) fileErrors.push(t('missing_columns', { columns: missing.join(', ') }))
    if (unknown.length) fileErrors.push(t('unknown_columns', { columns: unknown.join(', ') }))
    if (!records.length) fileErrors.push(t('no_rows'))
    if (records.length > CSV_IMPORT_MAX_ROWS) {
      fileErrors.push(t('too_many_rows', { max: CSV_IMPORT_MAX_ROWS }))
    }
    if (fileErrors.length) return { rows: [], fileErrors }

    const rows = records.map((record, index) => {
      const raw: Record<string, string> = {}
      header.forEach((name, column) => (raw[name] = (record[column] ?? '').trim()))
      return {
        line: index + 2,
        raw,
        clean: null,
        errors: [],
        parentAction: 'none' as ImportAction,
        childAction: 'none' as ImportAction,
        subscriptionAction: 'none' as ImportAction,
      }
    })
    return { rows, fileErrors: [] }
  }

  protected async validateRows(rows: WorkRow[], i18n: I18n) {
    const messagesProvider = i18n.createMessagesProvider()
    for (const row of rows) {
      const input: Record<string, string> = {}
      for (const [key, value] of Object.entries(row.raw)) if (value !== '') input[key] = value

      try {
        const data = await rowValidator.validate(input, { messagesProvider })
        const allergies: AllergenCode[] = []
        const invalid: string[] = []
        for (const code of (data.allergies ?? '').split(';')) {
          const normalized = code.trim().toLowerCase()
          if (!normalized) continue
          if (isAllergenCode(normalized)) {
            if (!allergies.includes(normalized)) allergies.push(normalized)
          } else invalid.push(code.trim())
        }
        if (invalid.length) {
          row.errors.push(
            i18n.t('families.import.errors.unknown_allergens', {
              codes: invalid.join(', '),
              allowed: ALLERGENS.join(', '),
            })
          )
        }
        const start = data.subscription_start ?? null
        const end = data.subscription_end ?? null
        if (end && !start) row.errors.push(i18n.t('families.import.errors.end_without_start'))
        if (start && end && end < start) {
          row.errors.push(i18n.t('families.errors.subscription_end_before_start'))
        }
        row.clean = {
          fullName: data.parent_full_name,
          email: data.parent_email,
          phone: data.parent_phone ?? null,
          locale: (data.parent_locale as AppLocale | undefined) ?? null,
          firstName: data.child_first_name,
          lastName: data.child_last_name,
          grade: data.grade ?? null,
          className: data.class_name ?? null,
          allergies,
          start,
          end,
        }
      } catch (error) {
        if (!(error instanceof vineErrors.E_VALIDATION_ERROR)) throw error
        for (const message of error.messages as { field: string; message: string }[]) {
          row.errors.push(`${message.field}: ${message.message}`)
        }
      }
    }
  }

  /** Same email = same parent; the same child must not appear twice. */
  protected checkFileConsistency(rows: WorkRow[], i18n: I18n) {
    const firstByEmail = new Map<string, WorkRow>()
    const seenChildren = new Map<string, number>()

    for (const row of rows) {
      const clean = row.clean
      if (!clean) continue
      const first = firstByEmail.get(clean.email)
      if (!first) firstByEmail.set(clean.email, row)
      else if (first.clean) {
        const a = first.clean
        const differs =
          a.fullName.toLowerCase() !== clean.fullName.toLowerCase() ||
          (a.phone && clean.phone && a.phone !== clean.phone) ||
          (a.locale && clean.locale && a.locale !== clean.locale)
        if (differs) {
          row.errors.push(i18n.t('families.import.errors.parent_mismatch', { line: first.line }))
        }
      }

      const key = childKey(clean.email, clean.firstName, clean.lastName)
      const seen = seenChildren.get(key)
      if (seen) row.errors.push(i18n.t('families.import.errors.duplicate_child', { line: seen }))
      else seenChildren.set(key, row.line)
    }
  }

  /** Matches rows with existing parents, children and subscription periods. */
  protected async checkAgainstDatabase(
    schoolId: number,
    rows: WorkRow[],
    i18n: I18n,
    client?: TransactionClientContract
  ) {
    const options = client ? { client } : {}
    const emails = [...new Set(rows.flatMap((row) => (row.clean ? [row.clean.email] : [])))]
    if (!emails.length) return

    const users = await User.query(options).whereRaw('lower(email) = ANY(?)', [emails])
    const usersByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]))
    const parentIds = users.filter((user) => user.role === 'parent').map((user) => user.id)

    const children = parentIds.length
      ? await Child.query(options).whereIn('parent_id', parentIds)
      : []
    const childrenByKey = new Map<string, Child>()
    for (const child of children) {
      const parent = users.find((user) => user.id === child.parentId)!
      childrenByKey.set(
        childKey(parent.email.toLowerCase(), child.firstName, child.lastName),
        child
      )
    }
    const periods = children.length
      ? await Subscription.query(options).whereIn(
          'child_id',
          children.map((child) => child.id)
        )
      : []

    const parentSeen = new Set<string>()
    for (const row of rows) {
      const clean = row.clean
      if (!clean) continue
      const user = usersByEmail.get(clean.email)

      // Parent
      if (user && user.role !== 'parent') {
        row.errors.push(i18n.t('families.import.errors.email_not_parent'))
        continue
      }
      if (user && user.schoolId !== schoolId) {
        row.errors.push(i18n.t('families.import.errors.other_school'))
        continue
      }
      const firstRowOfParent = !parentSeen.has(clean.email)
      parentSeen.add(clean.email)
      if (!user) row.parentAction = firstRowOfParent ? 'create' : 'none'
      else if (!firstRowOfParent) row.parentAction = 'none'
      else row.parentAction = this.parentChanges(user, clean) ? 'update' : 'unchanged'

      // Child
      const child = childrenByKey.get(childKey(clean.email, clean.firstName, clean.lastName))
      row.childAction = !child ? 'create' : this.childChanges(child, clean) ? 'update' : 'unchanged'

      // Subscription period
      if (!clean.start) row.subscriptionAction = 'none'
      else if (!child) row.subscriptionAction = 'create'
      else {
        const own = periods.filter((period) => period.childId === child.id)
        const same = own.find(
          (period) => period.startDate === clean.start && period.endDate === clean.end
        )
        if (same) row.subscriptionAction = 'unchanged'
        else {
          const clash = own.find(
            (period) =>
              period.startDate <= (clean.end ?? '9999-12-31') &&
              (period.endDate ?? '9999-12-31') >= clean.start!
          )
          if (clash) {
            row.errors.push(
              i18n.t('families.errors.subscription_overlap', {
                start: clash.startDate,
                end: clash.endDate ?? '…',
              })
            )
          } else row.subscriptionAction = 'create'
        }
      }
    }
  }

  protected parentChanges(user: User, clean: CleanRow) {
    return (
      user.fullName !== clean.fullName ||
      (clean.phone !== null && user.phone !== clean.phone) ||
      (clean.locale !== null && user.locale !== clean.locale)
    )
  }

  protected childChanges(child: Child, clean: CleanRow) {
    return (
      child.firstName !== clean.firstName ||
      child.lastName !== clean.lastName ||
      (clean.grade !== null && child.grade !== clean.grade) ||
      (clean.className !== null && child.className !== clean.className) ||
      clean.allergies.some((code) => !child.allergies.includes(code))
    )
  }

  protected async save(
    schoolId: number,
    rows: WorkRow[],
    trx: TransactionClientContract,
    result: ImportResult
  ): Promise<number[]> {
    const parents = new Map<string, User>()
    const newParentIds: number[] = []

    for (const row of rows) {
      const clean = row.clean!
      let parent = parents.get(clean.email)
      if (!parent) {
        const existing = await User.query({ client: trx })
          .whereRaw('lower(email) = ?', [clean.email])
          .first()
        if (existing) {
          if (this.parentChanges(existing, clean)) {
            existing.merge({
              fullName: clean.fullName,
              ...(clean.phone !== null ? { phone: clean.phone } : {}),
              ...(clean.locale !== null ? { locale: clean.locale } : {}),
            })
            await existing.save()
            result.updatedParents++
          }
          parent = existing
        } else {
          parent = await User.create(
            {
              fullName: clean.fullName,
              email: clean.email,
              phone: clean.phone,
              locale: clean.locale ?? 'fr',
              role: 'parent',
              schoolId,
              password: null,
              isActive: true,
              notificationPrefs: {},
              credentialsVersion: 0,
            },
            { client: trx }
          )
          newParentIds.push(parent.id)
          result.createdParents++
        }
        parents.set(clean.email, parent)
      }

      let child = await Child.query({ client: trx })
        .where('parent_id', parent.id)
        .whereRaw('lower(first_name) = ? AND lower(last_name) = ?', [
          clean.firstName.toLowerCase(),
          clean.lastName.toLowerCase(),
        ])
        .first()
      if (!child) {
        child = await Child.create(
          {
            parentId: parent.id,
            schoolId,
            firstName: clean.firstName,
            lastName: clean.lastName,
            grade: clean.grade,
            className: clean.className,
            allergies: clean.allergies,
            dietaryNotes: null,
            isActive: true,
          },
          { client: trx }
        )
        result.createdChildren++
      } else if (this.childChanges(child, clean)) {
        child.merge({
          firstName: clean.firstName,
          lastName: clean.lastName,
          ...(clean.grade !== null ? { grade: clean.grade } : {}),
          ...(clean.className !== null ? { className: clean.className } : {}),
          allergies: [...new Set([...child.allergies, ...clean.allergies])],
        })
        await child.save()
        result.updatedChildren++
      }

      if (clean.start) {
        const same = await Subscription.query({ client: trx })
          .where('child_id', child.id)
          .where('start_date', clean.start)
          .if(
            clean.end,
            (query) => query.where('end_date', clean.end!),
            (query) => query.whereNull('end_date')
          )
          .first()
        if (!same) {
          await this.subscriptions.create(
            child,
            { startDate: clean.start, endDate: clean.end, status: 'active' },
            trx
          )
          result.createdSubscriptions++
        }
      }
    }
    return newParentIds
  }

  protected plan(rows: WorkRow[], fileErrors: string[]): ImportPlan {
    const preview: ImportPreviewRow[] = rows.map((row) => ({
      line: row.line,
      parentName: row.clean?.fullName ?? row.raw.parent_full_name ?? '',
      email: row.clean?.email ?? row.raw.parent_email ?? '',
      childName: row.clean
        ? `${row.clean.firstName} ${row.clean.lastName}`
        : `${row.raw.child_first_name ?? ''} ${row.raw.child_last_name ?? ''}`.trim(),
      grade: row.clean?.grade ?? null,
      className: row.clean?.className ?? null,
      allergies: row.clean?.allergies ?? [],
      subscription: row.clean?.start ? { start: row.clean.start, end: row.clean.end } : null,
      parentAction: row.errors.length ? 'none' : row.parentAction,
      childAction: row.errors.length ? 'none' : row.childAction,
      subscriptionAction: row.errors.length ? 'none' : row.subscriptionAction,
      errors: row.errors,
    }))
    const ok = preview.filter((row) => !row.errors.length)
    const count = (
      key: 'parentAction' | 'childAction' | 'subscriptionAction',
      value: ImportAction
    ) => ok.filter((row) => row[key] === value).length

    const invalidRows = preview.length - ok.length
    return {
      fileErrors,
      rows: preview,
      summary: {
        rows: preview.length,
        invalidRows,
        newParents: count('parentAction', 'create'),
        updatedParents: count('parentAction', 'update'),
        newChildren: count('childAction', 'create'),
        updatedChildren: count('childAction', 'update'),
        newSubscriptions: count('subscriptionAction', 'create'),
      },
      valid: fileErrors.length === 0 && preview.length > 0 && invalidRows === 0,
    }
  }
}
