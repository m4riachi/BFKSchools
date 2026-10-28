import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import factory from '@adonisjs/lucid/factories'
import UserToken from '#models/user_token'

/**
 * Raw tokens are never stored: tests that need a usable link should go
 * through UserTokenService.issue(). This factory is for rows only.
 */
export const UserTokenFactory = factory
  .define(UserToken, () => ({
    type: 'invitation' as const,
    tokenHash: createHash('sha256').update(randomBytes(32).toString('base64url')).digest('hex'),
    expiresAt: DateTime.now().plus({ hours: 72 }),
  }))
  .build()
