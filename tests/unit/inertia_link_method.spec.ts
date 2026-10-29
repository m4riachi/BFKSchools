import { test } from '@japa/runner'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The `Link` from `@adonisjs/inertia/vue` declares `method` as a prop and, in
 * `href` mode, forwards only `href` + attrs to Inertia's Link — so
 * `<Link href="/logout" method="post">` silently becomes a GET (logout 404).
 * Any component that passes `method` to a Link must import it from
 * `@inertiajs/vue3`.
 */
async function vueFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return vueFiles(path)
      return Promise.resolve(entry.name.endsWith('.vue') ? [path] : [])
    })
  )
  return nested.flat()
}

test.group('Inertia Link method', () => {
  test('Links that set a method use the upstream @inertiajs/vue3 Link', async ({ assert }) => {
    const offenders: string[] = []
    for (const file of await vueFiles('inertia')) {
      const source = await readFile(file, 'utf8')
      const usesWrapper = /import\s*\{[^}]*\bLink\b[^}]*\}\s*from\s*'@adonisjs\/inertia\/vue'/.test(
        source
      )
      const linkWithMethod = /<Link\b[^>]*\s:?method=/s.test(source)
      if (usesWrapper && linkWithMethod) offenders.push(file)
    }
    assert.deepEqual(offenders, [])
  })
})
