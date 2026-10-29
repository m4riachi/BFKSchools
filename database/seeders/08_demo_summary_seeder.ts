import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { DEMO_USERS } from '#database/seeders/02_demo_users_seeder'
import {
  DEMO_FAMILY_DOMAIN,
  DEMO_PASSWORD,
  assertDemoSeeding,
  inProductionEnv,
  say,
} from '#database/demo/support'

/** Prints the demo logins and a few counts at the end of the demo seed (never prints a production password). */
export default class DemoSummarySeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    assertDemoSeeding()
    const count = async (sql: string) => {
      const result = await db.rawQuery(sql)
      return Number(result.rows[0]?.total ?? 0)
    }
    const families = await count(
      `SELECT count(*) AS total FROM users WHERE role = 'parent' AND password IS NOT NULL AND email LIKE '%@${DEMO_FAMILY_DOMAIN}'`
    )
    const stats = {
      parents: await count(`SELECT count(*) AS total FROM users WHERE role = 'parent'`),
      children: await count(`SELECT count(*) AS total FROM children`),
      meals: await count(`SELECT count(*) AS total FROM meals WHERE deleted_at IS NULL`),
      menus: await count(`SELECT count(*) AS total FROM weekly_menus`),
      orders: await count(`SELECT count(*) AS total FROM meal_orders WHERE status = 'active'`),
    }

    say('')
    const production = inProductionEnv()
    say(
      production
        ? 'Demo data ready (production, ALLOW_DEMO_SEED):'
        : 'Demo data ready (development only):'
    )
    say(
      `  ${stats.parents} parents, ${stats.children} children, ${stats.meals} meals, ${stats.menus} weekly menus, ${stats.orders} active day orders`
    )
    say(
      `  Sign in at ${env.get('APP_URL')}/login — password for every demo account: ${production ? 'the value of BFK_DEMO_PASSWORD' : DEMO_PASSWORD}`
    )
    for (const user of DEMO_USERS) {
      say(`    ${user.role.padEnd(8)} ${user.email}`)
    }
    say(
      `    parents  any of the ${families} @${DEMO_FAMILY_DOMAIN} parents with a password (e.g. karima.alaoui@${DEMO_FAMILY_DOMAIN})`
    )
    say('')
  }
}
