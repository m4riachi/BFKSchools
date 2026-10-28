import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import { UserFactory } from '#database/factories/user_factory'
import { createChild, createParent, setupSchool } from '#tests/helpers/families'

/** Every /admin route of the router, with params filled with real ids. */
function adminRoutes(ids: Record<string, string>) {
  const routes: { method: string; url: string }[] = []
  for (const list of Object.values(router.toJSON())) {
    for (const route of list) {
      if (!route.pattern.startsWith('/admin')) continue
      const url = route.pattern.replace(/:(\w+)/g, (_, name: string) =>
        // uuid params: family/holiday import ids and holiday range group ids
        route.pattern.includes('/imports/') ||
        route.pattern.includes('/holidays/import/') ||
        name === 'groupId'
          ? '6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c'
          : name === 'week'
            ? '2026-11-23' // weekly menus (Phase 5) are addressed by their Monday
            : (ids[name] ?? '1')
      )
      for (const method of route.methods) {
        if (method === 'HEAD') continue
        routes.push({ method, url })
      }
    }
  }
  return routes
}

test.group('Families | parents and kitchen never reach /admin', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  for (const role of ['parent', 'kitchen'] as const) {
    test('a {$self} is refused on every /admin route')
      .with([role])
      .run(async ({ client, assert }, userRole) => {
        const { school } = await setupSchool()
        const parent = await createParent(school.id)
        const child = await createChild(parent)
        const user =
          userRole === 'parent'
            ? parent
            : await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
        const routes = adminRoutes({
          id: String(parent.id),
          parentId: String(parent.id),
          childId: String(child.id),
        })
        assert.isAbove(routes.length, 15)

        for (const { method, url } of routes) {
          const request = client
            .request(url, method as any)
            .loginAs(user)
            .redirects(0)
          if (method !== 'GET') {
            request
              .withCsrfToken()
              .form({ fullName: 'Hacked', email: 'hacked@example.com', locale: 'fr' })
          }
          const response = await request
          const status = response.status()
          if (method === 'GET') {
            assert.equal(status, 403, `${method} ${url}`)
          } else {
            // Bouncer answers form submissions with flash + redirect back
            assert.include([302, 403], status, `${method} ${url}`)
            assert.notInclude(String(response.header('location') ?? ''), '/admin/parents/', url)
          }
        }

        await parent.refresh()
        assert.notEqual(parent.fullName, 'Hacked')
        assert.isNull(await User.findBy('email', 'hacked@example.com'))
      })
  }
})
