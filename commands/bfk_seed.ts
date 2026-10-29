import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Seeds one data profile, in any environment (unlike `node ace db:seed`,
 * whose demo seeders are development/test only):
 *
 *   node ace bfk:seed catalog --email=chef@bfk.ma --name="Chef BFK"
 *     The school, the meal catalog (13 trays with their real photos +
 *     supplements) and one staff account (admin by default). The password
 *     is asked, or read from BFK_NEW_PASSWORD (same rules as
 *     users:create-staff). An existing account is left untouched.
 *
 *   node ace bfk:seed demo
 *     Everything `db:seed` creates in development: accounts for every
 *     role, families, holidays, catalog, menus and orders. In production
 *     it needs ALLOW_DEMO_SEED=true and BFK_DEMO_PASSWORD (the password of
 *     every demo account; the development one is public).
 *
 * Both profiles are idempotent: running them again adds nothing twice.
 */
export default class BfkSeed extends BaseCommand {
  static commandName = 'bfk:seed'
  static description =
    'Seed a data profile: "catalog" (meals + photos + one account) or "demo" (all)'

  static options: CommandOptions = { startApp: true }

  @args.string({ description: 'catalog | demo' })
  declare profile: string

  @flags.string({ description: 'catalog: email of the account to create' })
  declare email?: string

  @flags.string({ description: 'catalog: full name of the account', default: 'Administrateur BFK' })
  declare name: string

  @flags.string({ description: 'catalog: admin | manager | kitchen', default: 'admin' })
  declare role: string

  async run() {
    if (this.profile === 'catalog') return this.seedCatalog()
    if (this.profile === 'demo') return this.seedDemo()
    this.fail('The profile must be "catalog" or "demo"')
  }

  protected async seedCatalog() {
    if (!this.email) return this.fail('--email is required for the catalog profile')
    const { default: db } = await import('@adonisjs/lucid/services/db')
    await this.runSeeders(['01_school_seeder'])

    const email = this.email.trim().toLowerCase()
    const existing = await db.from('users').whereRaw('lower(email) = ?', [email]).first()
    if (existing) {
      this.logger.info(`${email} already exists — account left as is`)
    } else {
      const command = await this.kernel.exec('users:create-staff', [
        `--email=${email}`,
        `--name=${this.name}`,
        `--role=${this.role}`,
      ])
      if (command.exitCode) return this.fail('The account was not created (see above)')
    }

    await this.runSeeders(['05_demo_catalog_seeder'])
    const meals = await db.from('meals').whereNull('deleted_at').count('* as total').first()
    this.logger.success(`Catalog ready: ${meals.total} meals. Sign in with ${email}.`)
  }

  protected async seedDemo() {
    // Checked before writing anything, so a refused run leaves no partial data.
    const { assertDemoSeeding, demoPassword } = await import('#database/demo/support')
    try {
      assertDemoSeeding()
      demoPassword()
    } catch (error) {
      return this.fail((error as Error).message)
    }
    await this.runSeeders([
      '01_school_seeder',
      '02_demo_users_seeder',
      '03_demo_family_seeder',
      '04_holiday_seeder',
      '05_demo_catalog_seeder',
      '06_demo_families_seeder',
      '07_demo_menus_orders_seeder',
      '08_demo_summary_seeder',
    ])
  }

  /**
   * Seeders are imported here, after the app has booted (ace imports every
   * command file first; models imported then could not hash passwords).
   */
  protected async runSeeders(names: string[]) {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    for (const name of names) {
      const { default: Seeder } = await import(`#database/seeders/${name}`)
      await new Seeder(db.connection()).run()
      this.logger.info(`seeded ${name}`)
    }
  }

  protected fail(message: string) {
    this.logger.error(message)
    this.exitCode = 1
  }
}
