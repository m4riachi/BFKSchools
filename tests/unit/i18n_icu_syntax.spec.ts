import { test } from '@japa/runner'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IntlMessageFormat } from 'intl-messageformat'

/**
 * QA: every translation must be valid ICU MessageFormat. A French apostrophe
 * before "#" or "{" (e.g. "qu'# portion") starts a quote and crashes `i18n.t`
 * with HTTP 500 at runtime.
 */
const root = join(process.cwd(), 'resources/lang')

function flatten(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]]
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
  }
  return []
}

for (const locale of readdirSync(root)) {
  for (const file of readdirSync(join(root, locale)).filter((f) => f.endsWith('.json'))) {
    test(`ICU syntax: ${locale}/${file}`, ({ assert }) => {
      const bad: string[] = []
      for (const [key, message] of flatten(
        JSON.parse(readFileSync(join(root, locale, file), 'utf8'))
      )) {
        try {
          new IntlMessageFormat(message, locale)
        } catch (error) {
          bad.push(`${key}: ${(error as Error).message}`)
        }
      }
      assert.deepEqual(bad, [])
    })
  }
}
