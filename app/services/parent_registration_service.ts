import { randomBytes } from 'node:crypto'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import logger from '@adonisjs/core/services/logger'
import i18nManager from '@adonisjs/i18n/services/main'
import QRCode from 'qrcode'
import env from '#start/env'
import School from '#models/school'
import User from '#models/user'
import Child from '#models/child'
import Clock from '#services/clock'
import ParentService from '#services/parent_service'
import ChildService, { throwIfPinError } from '#services/child_service'
import UserTokenService from '#services/user_token_service'
import { linkUrl } from '#services/account_link_service'
import AccountLinkMail from '#mails/account_link_mail'
import mail from '@adonisjs/mail/services/main'
import { maskEmail } from '#app/mail/log_transport'
import { safeMailError } from '#services/outbox_service'
import type { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import SchoolSettingsService from '#services/school_settings_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { whatsappNumber } from '#support/whatsapp'
import { APP_TIMEZONE } from '#support/time'
import type { AllergenCode } from '#enums/allergens'
import type { AppLocale } from '#enums/locales'
import { REGISTRATION_MAX_CHILDREN } from '#enums/parents'
import type { StoredSchoolSettings } from '#types/school_settings'

/** 32 base64url characters (192 random bits); matches the route's token matcher. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/
const UNIQUE_VIOLATION = '23505'

export const REGISTRATIONS_PER_PAGE = 20
/**
 * M1/M3: sign-ups waiting per school (confirmed, or with a usable link);
 * when full, new ones are dropped (same answer).
 */
export const REGISTRATION_MAX_PENDING = 200
/** pg_advisory_xact_lock key of the sign-ups of one school (7301: CSV import, 7303: kiosk codes). */
const REGISTRATION_LOCK_KEY = 7302

/** A sign-up whose email is not confirmed yet (pending, or refused — L3). */
function isUnconfirmedSignUp(user: User) {
  return (
    user.role === 'parent' &&
    (user.registrationStatus === 'pending' || user.registrationStatus === 'refused') &&
    !user.emailConfirmedAt
  )
}

/** "+212 6•• ••• •78": enough for the owner to recognise the number, not to read it. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = whatsappNumber(phone) ?? phone.replace(/\D/g, '')
  if (digits.length < 6) return '••••'
  const country = digits.length > 9 ? digits.slice(0, digits.length - 9) : ''
  const local = digits.slice(country.length)
  const hidden = `${local[0]}${'•'.repeat(local.length - 3)}${local.slice(-2)}`
  const grouped = `${hidden.slice(0, 3)} ${hidden.slice(3, 6)} ${hidden.slice(6)}`.trim()
  return country ? `+${country} ${grouped}` : grouped
}

export function registrationPath(token: string) {
  return `/inscription/${token}`
}

export function registrationUrl(token: string) {
  return new URL(registrationPath(token), env.get('APP_URL')).toString()
}

export function newRegistrationToken() {
  return randomBytes(24).toString('base64url')
}

export type RegistrationChildInput = {
  firstName: string
  lastName: string
  grade?: string | null
  className?: string | null
  allergies?: AllergenCode[]
  dietaryNotes?: string | null
}

export type RegistrationInput = {
  fullName: string
  email: string
  phone: string
  locale: AppLocale
  password: string
  children: RegistrationChildInput[]
}

/**
 * D59: parents sign up themselves from the QR code shown on the school board
 * and on the poster of the settings. The account waits for the school
 * (`registration_status = pending`, parent and children inactive); staff
 * activate it (parent + children active) or refuse it (kept, deactivated).
 * After activation, staff send the children's kiosk codes on WhatsApp.
 */
@inject()
export default class ParentRegistrationService {
  constructor(
    protected clock: Clock,
    protected parents: ParentService,
    protected children: ChildService,
    protected settings: SchoolSettingsService,
    protected tokens: UserTokenService
  ) {}

  /* ------------------------------------------------------------------ */
  /* School settings: switch + link token                                 */
  /* ------------------------------------------------------------------ */

  /** The school whose sign-up link is `token` while sign-ups are on, or null. */
  async findSchool(token: string): Promise<School | null> {
    if (!TOKEN_PATTERN.test(token)) return null
    const school = await School.query()
      .whereRaw(`settings->>'registration_token' = ?`, [token])
      .first()
    if (!school) return null
    const values = this.settings.get(school)
    return values.registration_enabled && values.registration_token === token ? school : null
  }

  /** Public link of the school's sign-up form, or null while sign-ups are off. */
  linkOf(school: Pick<School, 'settings'>): string | null {
    const values = this.settings.get(school)
    return values.registration_enabled && values.registration_token
      ? registrationUrl(values.registration_token)
      : null
  }

  /** Turns sign-ups on (a token is created the first time). */
  async enable(school: School) {
    await this.store(school, (current) => ({
      registration_enabled: true,
      registration_token: current.registration_token ?? newRegistrationToken(),
    }))
  }

  /** Turns sign-ups off; the token is kept, so turning them on again keeps the printed QR. */
  async disable(school: School) {
    await this.store(school, () => ({ registration_enabled: false }))
  }

  /** A new token: the previous link and every printed QR stop working. */
  async regenerateToken(school: School) {
    await this.store(school, () => ({ registration_token: newRegistrationToken() }))
  }

  protected async store(
    school: School,
    change: (
      current: ReturnType<SchoolSettingsService['get']>
    ) => Partial<ReturnType<SchoolSettingsService['get']>>
  ) {
    await db.transaction(async (trx) => {
      const locked = await School.query({ client: trx })
        .where('id', school.id)
        .forUpdate()
        .firstOrFail()
      const current = this.settings.get(locked)
      locked.settings = { ...current, ...change(current) } as StoredSchoolSettings
      await locked.save()
      school.settings = locked.settings
    })
  }

  /** The QR code of a link as an SVG data URL (board overlay, settings preview). */
  async qrDataUrl(url: string): Promise<string> {
    const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  }

  /* ------------------------------------------------------------------ */
  /* The public form                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Creates the pending parent and their inactive children in one
   * transaction, then emails the single-use confirmation link (sent
   * directly, never stored in the outbox: it carries the raw token, D16).
   * Sign-up children get no kiosk code yet (`registration_pending`, D59).
   * Fields of modules the school turned off are dropped.
   *
   * Returns what happened, for logs and tests only — the controller runs
   * this after the response (DeferredTasks) and always answers the same:
   * an email that already has an account, or a school whose waiting list
   * is full, creates and sends nothing.
   */
  async register(
    school: School,
    input: RegistrationInput
  ): Promise<'created' | 'duplicate' | 'full'> {
    const features = this.settings.features(school)
    const children = this.uniqueChildren(input.children).map((child) => ({
      firstName: child.firstName,
      lastName: child.lastName,
      grade: features.grade ? (child.grade ?? null) : null,
      className: features.className ? (child.className ?? null) : null,
      allergies: features.allergens ? (child.allergies ?? []) : [],
      dietaryNotes: child.dietaryNotes ?? null,
      isActive: false,
      registrationPending: true,
    }))
    if (!children.length || children.length > REGISTRATION_MAX_CHILDREN) {
      throw new BusinessRuleException('families.registration.errors.children', {
        field: 'children',
      })
    }

    // Hashed before any transaction (M1): no database connection is held
    // during the slow part. Known emails pay the same cost.
    const passwordHash = await hash.make(input.password)
    if (await User.findByEmail(input.email)) return 'duplicate'

    let created: { parent: User; token: string; expiresAt: DateTime } | null
    try {
      created = await db.transaction(async (trx) => {
        // Serializes the sign-ups of one school (cap) without locking the school row.
        await trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [REGISTRATION_LOCK_KEY, school.id])
        if ((await this.waitingCount(school.id, trx)) >= REGISTRATION_MAX_PENDING) return null
        const parent = await this.parents.create(
          school.id,
          {
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            locale: input.locale,
          },
          {
            client: trx,
            isActive: false,
            registrationStatus: 'pending',
            registeredAt: this.clock.now(),
          }
        )
        // The hash computed above, stored as is (the model hook would hash it again).
        await trx.from('users').where('id', parent.id).update({ password: passwordHash })
        for (const child of children) await this.children.create(parent, child, trx)
        const { token, record } = await this.tokens.issue(parent, 'email_confirmation', { trx })
        return { parent, token, expiresAt: record.expiresAt }
      })
    } catch (error) {
      // Same email submitted twice at once: the unique index answers.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'duplicate'
      throw error
    }
    if (!created) {
      logger.warn({ schoolId: school.id }, 'parent sign-up dropped: waiting list full')
      return 'full'
    }
    logger.info({ schoolId: school.id, parentId: created.parent.id }, 'parent sign-up received')
    await this.sendConfirmation(created.parent, created.token, created.expiresAt)
    return 'created'
  }

  protected async sendConfirmation(parent: User, token: string, expiresAt: DateTime) {
    try {
      await mail.send(
        new AccountLinkMail(
          'email_confirmation',
          parent,
          linkUrl('email_confirmation', token),
          expiresAt
        )
      )
      return true
    } catch (error) {
      logger.error(
        { error: safeMailError(error), to: maskEmail(parent.email) },
        'sign-up confirmation email failed'
      )
      return false
    }
  }

  /**
   * Staff "renvoyer le lien": a new confirmation link for a sign-up whose
   * email is not confirmed yet — pending, or refused (L3: confirming then
   * keeps it refused; staff can approve it) — the previous link stops working.
   */
  async resendConfirmation(parent: User) {
    const issued = await db.transaction(async (trx) => {
      const locked = await User.query({ client: trx }).where('id', parent.id).forUpdate().first()
      if (!locked || !isUnconfirmedSignUp(locked)) {
        throw new BusinessRuleException('families.registration.errors.not_unconfirmed')
      }
      return this.tokens.issue(locked, 'email_confirmation', { trx })
    })
    if (!(await this.sendConfirmation(parent, issued.token, issued.record.expiresAt))) {
      throw new BusinessRuleException('families.errors.invitation_email_failed')
    }
  }

  /**
   * Staff "Renvoyer par WhatsApp": a new confirmation link (the previous one
   * stops working) in a wa.me message to the phone the parent typed, in the
   * parent's language. Nothing is sent from here: staff press send (D43).
   */
  async whatsappConfirmation(parent: User, actor: User): Promise<string> {
    const number = whatsappNumber(parent.phone)
    if (!number) throw new BusinessRuleException('families.errors.no_whatsapp_number')
    const { token, record, locked } = await db.transaction(async (trx) => {
      const current = await User.query({ client: trx }).where('id', parent.id).forUpdate().first()
      if (!current || !isUnconfirmedSignUp(current)) {
        throw new BusinessRuleException('families.registration.errors.not_unconfirmed')
      }
      const issued = await this.tokens.issue(current, 'email_confirmation', {
        trx,
        createdBy: actor.id,
      })
      return { ...issued, locked: current }
    })
    const message = i18nManager
      .locale(locked.locale)
      .t('families.registration.whatsapp_confirmation', {
        name: locked.fullName,
        url: linkUrl('email_confirmation', token),
        date: record.expiresAt
          .setZone(APP_TIMEZONE)
          .setLocale(locked.locale)
          .toLocaleString({ dateStyle: 'long', timeStyle: 'short' }),
      })
    logger.info(
      { parentId: parent.id, actorId: actor.id },
      'sign-up confirmation link sent by WhatsApp'
    )
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
  }

  /**
   * Staff confirm the email themselves, after checking the parent another
   * way (phone, WhatsApp, in person). Records who did; open links stop working.
   */
  async confirmEmailByStaff(parent: User, actor: User) {
    await db.transaction(async (trx) => {
      const locked = await User.query({ client: trx }).where('id', parent.id).forUpdate().first()
      if (!locked || !isUnconfirmedSignUp(locked)) {
        throw new BusinessRuleException('families.registration.errors.not_unconfirmed')
      }
      locked.merge({ emailConfirmedAt: this.clock.now(), emailConfirmedBy: actor.id })
      await locked.save()
      await this.tokens.revokeOpen(parent.id, trx, 'email_confirmation')
    })
    await parent.refresh()
    logger.info({ parentId: parent.id, actorId: actor.id }, 'sign-up email confirmed by staff')
    return parent
  }

  /**
   * What the confirmation page shows (M2) for a usable link — nothing is
   * consumed: the parent's name, the phone masked, the children's first
   * names. Null when the link cannot be used.
   */
  async confirmationSummary(rawToken: string) {
    const record = await this.tokens.findUsable(rawToken, 'email_confirmation', {
      allowInactive: true,
    })
    if (!record || !isUnconfirmedSignUp(record.user)) return null
    const children = await Child.query()
      .where('parent_id', record.user.id)
      .where('registration_pending', true)
      .orderBy('id', 'asc')
      .select('first_name')
    return {
      fullName: record.user.fullName,
      phone: maskPhone(record.user.phone),
      children: children.map((child) => child.firstName),
    }
  }

  /**
   * Consumes a confirmation link (single use, expiring) and marks the
   * sign-up's email as confirmed (a refused one stays refused, L3). False
   * when the link cannot be used.
   * Lock order as in UserTokenService.issue: user row, then the token.
   */
  async confirmEmail(rawToken: string): Promise<boolean> {
    const owner = await this.tokens.findOwner(rawToken, 'email_confirmation')
    if (owner === null) return false
    return db.transaction(async (trx) => {
      const user = await User.query({ client: trx }).where('id', owner).forUpdate().first()
      if (!user || !isUnconfirmedSignUp(user)) return false
      const record = await this.tokens.consume(rawToken, 'email_confirmation', trx)
      if (!record || record.userId !== user.id) return false
      user.emailConfirmedAt = this.clock.now()
      await user.save()
      return true
    })
  }

  /**
   * M2 — "Ce n'est pas moi": the owner of the address did not ask for this
   * account. The same single-use link is consumed and the sign-up refused
   * (kept, deactivated, kiosk codes cleared; no reviewer). False when the
   * link cannot be used.
   */
  async declineByEmail(rawToken: string): Promise<boolean> {
    const owner = await this.tokens.findOwner(rawToken, 'email_confirmation')
    if (owner === null) return false
    const declined = await db.transaction(async (trx) => {
      const user = await this.lockForReview(owner, trx)
      if (!user || !isUnconfirmedSignUp(user)) return false
      const record = await this.tokens.consume(rawToken, 'email_confirmation', trx)
      if (!record || record.userId !== user.id) return false
      // Already refused by staff: keep their review, just use up the link.
      if (user.registrationStatus === 'pending') await this.markRefused(user, null, trx)
      return true
    })
    if (declined) logger.info({ parentId: owner }, 'parent sign-up declined by the email owner')
    return declined
  }

  /** The same child typed twice (same first + last name) is kept once. */
  protected uniqueChildren(children: RegistrationChildInput[]) {
    const seen = new Set<string>()
    return children.filter((child) => {
      const key = `${child.firstName.toLowerCase()}|${child.lastName.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /* ------------------------------------------------------------------ */
  /* Back-office: the "À activer" list                                    */
  /* ------------------------------------------------------------------ */

  async pendingCount(schoolId: number): Promise<number> {
    const row = await db
      .from('users')
      .where('school_id', schoolId)
      .where('role', 'parent')
      .where('registration_status', 'pending')
      .count('* as total')
      .first()
    return Number(row?.total ?? 0)
  }

  /**
   * M3: sign-ups that count toward the cap — pending, and either confirmed
   * or still holding a usable confirmation link (an unconfirmed sign-up
   * whose link expired no longer takes a place; staff can resend it).
   */
  protected async waitingCount(schoolId: number, trx: TransactionClientContract) {
    const row = await trx
      .from('users')
      .where('school_id', schoolId)
      .where('role', 'parent')
      .where('registration_status', 'pending')
      .where((query) =>
        query
          .whereNotNull('email_confirmed_at')
          .orWhereExists((tokens) =>
            tokens
              .from('user_tokens')
              .whereColumn('user_tokens.user_id', 'users.id')
              .where('user_tokens.type', 'email_confirmation')
              .whereNull('user_tokens.used_at')
              .whereNull('user_tokens.revoked_at')
              .where('user_tokens.expires_at', '>', this.clock.now().toJSDate())
          )
      )
      .count('* as total')
      .first()
    return Number(row?.total ?? 0)
  }

  /**
   * Pending sign-ups with what the parent typed, oldest first, and whether
   * an unconfirmed one still has a usable link (M3: "lien expiré" otherwise).
   */
  async pending(schoolId: number, page = 1) {
    const result = await User.query()
      .where('role', 'parent')
      .where('school_id', schoolId)
      .where('registration_status', 'pending')
      .preload('children', (query) => query.orderBy('id', 'asc'))
      .orderBy('registered_at', 'asc')
      .orderBy('id', 'asc')
      .paginate(page, REGISTRATIONS_PER_PAGE)
    const ids = result.all().map((user) => user.id)
    const open = ids.length
      ? await db
          .from('user_tokens')
          .whereIn('user_id', ids)
          .where('type', 'email_confirmation')
          .whereNull('used_at')
          .whereNull('revoked_at')
          .where('expires_at', '>', this.clock.now().toJSDate())
          .select('user_id')
      : []
    const withLink = new Set(open.map((row) => Number(row.user_id)))
    for (const user of result.all()) {
      user.$extras.confirmation_link_open = withLink.has(user.id)
    }
    return result
  }

  /**
   * Activates a sign-up (pending, or refused earlier): parent and children
   * active, status approved, reviewer recorded. Lock order as in
   * ParentService.deactivate: school, children, then the parent.
   */
  async approve(parent: User, actor: User) {
    await db.transaction(async (trx) => {
      const locked = await this.lockForReview(parent.id, trx)
      if (
        !locked ||
        locked.role !== 'parent' ||
        (locked.registrationStatus !== 'pending' && locked.registrationStatus !== 'refused')
      ) {
        throw new BusinessRuleException('families.registration.errors.not_pending')
      }
      // H1: nobody can claim someone else's email — it must be confirmed first.
      if (!locked.emailConfirmedAt) {
        throw new BusinessRuleException('families.registration.errors.email_not_confirmed')
      }
      locked.merge({
        isActive: true,
        registrationStatus: 'approved',
        registrationReviewedAt: this.clock.now(),
        registrationReviewedBy: actor.id,
      })
      await locked.save()
      // Only the children the sign-up created (never ones staff deactivated
      // or the import added); the trigger gives each its kiosk code now.
      try {
        await trx
          .from('children')
          .where('parent_id', parent.id)
          .where('registration_pending', true)
          .update({
            is_active: true,
            registration_pending: false,
            updated_at: this.clock.now().toJSDate(),
          })
      } catch (error) {
        throwIfPinError(error)
        throw error
      }
    })
    await parent.refresh()
    logger.info({ parentId: parent.id, actorId: actor.id }, 'parent sign-up approved')
    return parent
  }

  /** Refuses a pending sign-up: kept, deactivated, status refused (D59). */
  async refuse(parent: User, actor: User) {
    await db.transaction(async (trx) => {
      const locked = await this.lockForReview(parent.id, trx)
      if (!locked || locked.role !== 'parent' || locked.registrationStatus !== 'pending') {
        throw new BusinessRuleException('families.registration.errors.not_pending')
      }
      await this.markRefused(locked, actor, trx)
      await this.tokens.revokeOpen(parent.id, trx)
    })
    await parent.refresh()
    logger.info({ parentId: parent.id, actorId: actor.id }, 'parent sign-up refused')
    return parent
  }

  /**
   * Same lock order everywhere a sign-up is reviewed (L2), as in
   * ParentService.deactivate: school (share), children by id, then the parent.
   */
  protected async lockForReview(parentId: number, trx: TransactionClientContract) {
    const schoolRow = await trx.from('users').where('id', parentId).select('school_id').first()
    if (schoolRow?.school_id) {
      await trx.from('schools').where('id', schoolRow.school_id).forShare().select('id')
    }
    await trx.from('children').where('parent_id', parentId).orderBy('id').forUpdate().select('id')
    return User.query({ client: trx }).where('id', parentId).forUpdate().first()
  }

  /** Status refused, account inactive, the sign-up children keep no kiosk code (H2). */
  protected async markRefused(user: User, actor: User | null, trx: TransactionClientContract) {
    user.useTransaction(trx)
    user.merge({
      isActive: false,
      registrationStatus: 'refused',
      registrationReviewedAt: this.clock.now(),
      registrationReviewedBy: actor?.id ?? null,
    })
    await user.save()
    await trx
      .from('children')
      .where('parent_id', user.id)
      .where('registration_pending', true)
      .update({ pin: null, is_active: false })
  }

  /**
   * After activation (D59, D43 click-to-chat): the wa.me link with a message
   * in the parent's language — the login address and each active child's
   * kiosk code (Code borne). Nothing is sent from here: staff press send.
   */
  async whatsappActivation(parent: User): Promise<string> {
    const number = whatsappNumber(parent.phone)
    if (!number) throw new BusinessRuleException('families.errors.no_whatsapp_number')
    if (!parent.isActive || parent.registrationStatus !== 'approved') {
      throw new BusinessRuleException('families.registration.errors.not_approved')
    }
    const children = await Child.query()
      .where('parent_id', parent.id)
      .where('is_active', true)
      .whereNotNull('pin')
      .orderByRaw('lower(first_name), lower(last_name)')
    const i18n = i18nManager.locale(parent.locale)
    const lines = children.map((child) =>
      i18n.t('families.registration.whatsapp_child', {
        name: `${child.firstName} ${child.lastName}`,
        pin: child.pin!,
      })
    )
    const message = i18n.t('families.registration.whatsapp_message', {
      name: parent.fullName,
      url: new URL('/login', env.get('APP_URL')).toString(),
      email: parent.email,
      children: lines.join('\n'),
    })
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
  }
}
