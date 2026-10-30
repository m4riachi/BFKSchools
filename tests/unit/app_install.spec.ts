import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'

test.group('Installable app', () => {
  test('the launch logo is a same-origin file, allowed by the content security policy', async ({
    assert,
  }) => {
    const layout = await readFile(app.makePath('resources/views/inertia_layout.edge'), 'utf8')
    assert.include(layout, '<script src="/splash.js"></script>')
    await assert.doesNotReject(() => readFile(app.makePath('public/splash.js')))
    const script = await readFile(app.makePath('public/splash.js'), 'utf8')
    await assert.doesNotReject(() =>
      readFile(app.makePath('public', script.match(/image\.src = '(.+?)'/)![1]))
    )
  })

  test('the manifest has what browsers require, and every icon exists', async ({ assert }) => {
    const manifest = JSON.parse(await readFile(app.makePath('public/manifest.webmanifest'), 'utf8'))
    assert.equal(manifest.display, 'standalone')
    assert.equal(manifest.start_url, '/')
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes)
    assert.includeMembers(sizes, ['192x192', '512x512'])
    for (const icon of manifest.icons) {
      await assert.doesNotReject(() => readFile(app.makePath('public', icon.src)))
    }
  })
})
