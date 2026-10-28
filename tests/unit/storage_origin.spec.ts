import { test } from '@japa/runner'
import { S3Driver } from 'flydrive/drivers/s3'
import { makeShieldConfig } from '#config/shield'
import { assertDriveEnv } from '#support/env_guards'
import {
  imgSrcDirective,
  isVirtualHostableBucket,
  parseHttpsOrigin,
  s3DriverSettings,
  s3PublicOrigin,
  type StorageEnv,
} from '#support/storage_origin'

const aws: StorageEnv = { DRIVE_DISK: 's3', S3_REGION: 'eu-west-3', S3_BUCKET: 'bfk-photos' }
const r2: StorageEnv = {
  DRIVE_DISK: 's3',
  S3_REGION: 'auto',
  S3_BUCKET: 'bfk-photos',
  S3_ENDPOINT: 'https://acc123.r2.cloudflarestorage.com',
}
const minio: StorageEnv = {
  DRIVE_DISK: 's3',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'bfk-photos',
  S3_ENDPOINT: 'https://minio.example.com:9443',
  S3_FORCE_PATH_STYLE: true,
}

test.group('Storage origin | derivation', () => {
  test('fs disk: no bucket origin, img-src unchanged', ({ assert }) => {
    assert.isNull(s3PublicOrigin({ DRIVE_DISK: 'fs' }))
    assert.deepEqual(imgSrcDirective({ DRIVE_DISK: 'fs' }), [`'self'`, 'data:', 'blob:'])
  })

  test('AWS virtual-hosted', ({ assert }) => {
    assert.equal(s3PublicOrigin(aws), 'https://bfk-photos.s3.eu-west-3.amazonaws.com')
  })

  test('AWS bucket with dots falls back to path style (like the SDK)', ({ assert }) => {
    assert.equal(
      s3PublicOrigin({ ...aws, S3_BUCKET: 'bfk.photos' }),
      'https://s3.eu-west-3.amazonaws.com'
    )
    assert.isFalse(isVirtualHostableBucket('bfk.photos'))
    assert.isFalse(isVirtualHostableBucket('-bfk'))
    assert.isFalse(isVirtualHostableBucket('Bfk'))
    assert.isFalse(isVirtualHostableBucket('ab'))
    assert.isTrue(isVirtualHostableBucket('bfk-photos-2026'))
  })

  test('endpoint, virtual-hosted (R2 default)', ({ assert }) => {
    assert.equal(s3PublicOrigin(r2), 'https://bfk-photos.acc123.r2.cloudflarestorage.com')
  })

  test('endpoint, path-style (MinIO / R2 forced)', ({ assert }) => {
    assert.equal(s3PublicOrigin(minio), 'https://minio.example.com:9443')
    assert.equal(
      s3PublicOrigin({ ...r2, S3_FORCE_PATH_STYLE: true }),
      'https://acc123.r2.cloudflarestorage.com'
    )
    assert.equal(
      s3PublicOrigin({ ...r2, S3_ENDPOINT: 'https://acc123.r2.cloudflarestorage.com/some/path' }),
      'https://bfk-photos.acc123.r2.cloudflarestorage.com'
    )
  })

  test('explicit S3_PUBLIC_ORIGIN overrides the derivation', ({ assert }) => {
    assert.equal(
      s3PublicOrigin({ ...r2, S3_PUBLIC_ORIGIN: 'https://photos.example.com' }),
      'https://photos.example.com'
    )
    assert.equal(
      s3PublicOrigin({ ...aws, S3_PUBLIC_ORIGIN: 'https://photos.example.com:443/' }),
      'https://photos.example.com'
    )
  })

  test('invalid S3_PUBLIC_ORIGIN values are refused', ({ assert }) => {
    for (const value of [
      'http://photos.example.com',
      'https://photos.example.com/bucket',
      'https://photos.example.com?x=1',
      'https://photos.example.com#x',
      'https://*.example.com',
      'https:',
      '*',
      'photos.example.com',
      'https://user:pass@photos.example.com',
    ]) {
      assert.isNull(parseHttpsOrigin(value), value)
      assert.throws(() => s3PublicOrigin({ ...aws, S3_PUBLIC_ORIGIN: value }), /S3_PUBLIC_ORIGIN/)
    }
  })

  test('AWS without a usable region is refused', ({ assert }) => {
    assert.throws(() => s3PublicOrigin({ ...aws, S3_REGION: 'auto' }), /S3_REGION/)
  })
})

test.group('Storage origin | production CSP', () => {
  test('img-src lists exactly self, data:, blob: and the bucket origin', ({ assert }) => {
    for (const storage of [aws, r2, minio]) {
      const config = makeShieldConfig({ inProduction: true, storage })
      assert.isTrue(config.csp.enabled)
      assert.deepEqual(config.csp.directives?.imgSrc, [
        `'self'`,
        'data:',
        'blob:',
        s3PublicOrigin(storage)!,
      ])
      const sources = [...(config.csp.directives!.imgSrc as string[])].join(' ')
      assert.notMatch(sources, /(^|\s)(https:|\*)(\s|$)/, 'never a wildcard')
    }
    const fs = makeShieldConfig({ inProduction: true, storage: { DRIVE_DISK: 'fs' } })
    assert.deepEqual(fs.csp.directives?.imgSrc, [`'self'`, 'data:', 'blob:'])
  })
})

test.group('Storage origin | matches URLs signed by the Drive S3 driver', () => {
  const configs: Array<[string, StorageEnv]> = [
    ['AWS virtual-hosted', aws],
    ['AWS us-east-1', { ...aws, S3_REGION: 'us-east-1' }],
    ['AWS bucket with dots', { ...aws, S3_BUCKET: 'bfk.photos' }],
    ['R2 virtual-hosted', r2],
    ['R2 path-style', { ...r2, S3_FORCE_PATH_STYLE: true }],
    ['MinIO path-style', minio],
    ['MinIO virtual-hosted', { ...minio, S3_FORCE_PATH_STYLE: false }],
    [
      'Scaleway bucket with dots',
      {
        ...r2,
        S3_REGION: 'fr-par',
        S3_BUCKET: 'bfk.photos',
        S3_ENDPOINT: 'https://s3.fr-par.scw.cloud',
      },
    ],
  ]

  for (const [label, storage] of configs) {
    test(label, async ({ assert }) => {
      // Same options as config/drive.ts; presigning is local (no network).
      const driver = new S3Driver({
        credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
        visibility: 'private',
        ...s3DriverSettings(storage),
      })
      const signed = await driver.getSignedUrl(
        'meals/1/0f8fad5b-d9cb-469f-a165-70867728950e_thumb.webp',
        {
          expiresIn: '10 mins',
          contentType: 'image/webp',
        }
      )
      assert.equal(new URL(signed).origin, s3PublicOrigin(storage))
    })
  }
})

test.group('Storage origin | env guard', () => {
  const full = {
    DRIVE_DISK: 's3',
    S3_ACCESS_KEY_ID: 'a',
    S3_SECRET_ACCESS_KEY: 's',
    S3_REGION: 'auto',
    S3_BUCKET: 'bfk-photos',
  }

  test('production requires an https S3_ENDPOINT', ({ assert }) => {
    assert.throws(
      () =>
        assertDriveEnv({ ...full, NODE_ENV: 'production', S3_ENDPOINT: 'http://minio.local:9000' }),
      /https in production/
    )
    assert.doesNotThrow(() =>
      assertDriveEnv({ ...full, NODE_ENV: 'development', S3_ENDPOINT: 'http://127.0.0.1:9000' })
    )
    assert.doesNotThrow(() =>
      assertDriveEnv({
        ...full,
        NODE_ENV: 'production',
        S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com',
      })
    )
  })

  test('an invalid S3_PUBLIC_ORIGIN stops the startup', ({ assert }) => {
    assert.throws(
      () =>
        assertDriveEnv({
          ...full,
          S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com',
          S3_PUBLIC_ORIGIN: 'https:',
        }),
      /S3_PUBLIC_ORIGIN/
    )
  })
})
