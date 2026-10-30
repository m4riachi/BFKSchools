import { randomBytes } from 'node:crypto'
import { inject } from '@adonisjs/core'
import { safeEqual } from '@adonisjs/core/helpers'
import encryption from '@adonisjs/core/services/encryption'
import School from '#models/school'
import SchoolApiKey from '#models/school_api_key'
import type User from '#models/user'
import Clock from '#services/clock'

/**
 * Keys of the external API (D36): one public + secret pair per school.
 * Generating again replaces the pair, so the old keys stop working at once.
 */
@inject()
export default class ApiKeyService {
  constructor(protected clock: Clock) {}

  forSchool(schoolId: number) {
    return SchoolApiKey.findBy('schoolId', schoolId)
  }

  async generate(schoolId: number, user: User) {
    const publicKey = `bfk_pk_${randomBytes(16).toString('hex')}`
    const secret = `bfk_sk_${randomBytes(32).toString('hex')}`
    await SchoolApiKey.updateOrCreate(
      { schoolId },
      {
        publicKey,
        secretEncrypted: encryption.encrypt(secret),
        generatedBy: user.id,
        generatedAt: this.clock.now(),
      }
    )
    return { publicKey, secret }
  }

  /** Null when it cannot be decrypted (APP_KEY changed): generate new keys. */
  secretOf(key: SchoolApiKey) {
    return encryption.decrypt<string>(key.secretEncrypted)
  }

  /** The school of a valid pair, null otherwise. */
  async authenticate(publicKey: string, secret: string) {
    const key = await SchoolApiKey.findBy('publicKey', publicKey)
    if (!key) return null
    const expected = this.secretOf(key)
    if (!expected || !safeEqual(expected, secret)) return null
    return School.find(key.schoolId)
  }
}
