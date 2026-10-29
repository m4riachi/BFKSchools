import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { isSafeEmail, passwordStrengthIssues, PASSWORD_MAX_LENGTH } from '#validators/rules'
import { KITCHEN_ROLES, type Role } from '#enums/roles'

/**
 * Creates a back-office account (admin, manager or kitchen) — the way to
 * get the first admin on a fresh production database (demo seeders never
 * run there). The password is asked interactively (hidden), or read from
 * the BFK_NEW_PASSWORD environment variable for scripted setups; it must
 * pass the same strength rules as the set-password page.
 *
 *   node ace users:create-staff --email=nadia@bfk.ma --name="Nadia Lahlou" --role=admin
 *
 * An existing email is refused (no silent password reset).
 */
export default class UsersCreateStaff extends BaseCommand {
  static commandName = 'users:create-staff'
  static description = 'Create an admin, manager or kitchen account (asks for the password)'

  static options: CommandOptions = { startApp: true }

  @flags.string({ description: 'Email address (sign-in)', required: true })
  declare email: string

  @flags.string({ description: 'Full name', required: true })
  declare name: string

  @flags.string({ description: 'admin | manager | kitchen', default: 'admin' })
  declare role: string

  @flags.string({ description: 'School slug', default: 'britech-school' })
  declare school: string

  @flags.string({ description: 'Interface language: fr | en', default: 'fr' })
  declare locale: string

  async run() {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const { default: hash } = await import('@adonisjs/core/services/hash')
    const email = this.email.trim().toLowerCase()
    const role = this.role as Role
    if (!KITCHEN_ROLES.includes(role)) {
      return this.fail(`--role must be one of ${KITCHEN_ROLES.join(', ')}`)
    }
    if (!isSafeEmail(email)) return this.fail('--email is not a valid address')
    if (!['fr', 'en'].includes(this.locale)) return this.fail('--locale must be fr or en')
    const name = this.name.trim().replace(/\s+/g, ' ')
    if (!name) return this.fail('--name is required')

    const school = await db.from('schools').where('slug', this.school).select('id', 'name').first()
    if (!school) {
      return this.fail(
        `School "${this.school}" not found (create it first with "node ace db:seed")`
      )
    }
    const taken = await db.from('users').whereRaw('lower(email) = ?', [email]).select('id').first()
    if (taken) return this.fail(`An account already uses ${email}`)

    const password: string =
      process.env.BFK_NEW_PASSWORD ??
      (await this.prompt.secure('Password for the new account')) ??
      ''
    const issues = passwordStrengthIssues(password)
    if (issues.length || password.length > PASSWORD_MAX_LENGTH) {
      return this.fail(
        'The password must have 10–128 characters with at least one letter and one digit'
      )
    }

    // Plain insert with an explicit hash: in development ace imports every
    // command file before the app boots, so the User model (whose auth mixin
    // captures the hash service when its module is evaluated) can't hash here.
    const [row] = await db
      .table('users')
      .insert({
        email,
        full_name: name,
        role,
        locale: this.locale,
        password: await hash.make(password),
        school_id: school.id,
        is_active: true,
        credentials_version: 0,
      })
      .returning('id')
    this.logger.success(`Created ${role} ${email} (id ${row.id ?? row}) for ${school.name}`)
  }

  protected fail(message: string) {
    this.logger.error(message)
    this.exitCode = 1
  }
}
