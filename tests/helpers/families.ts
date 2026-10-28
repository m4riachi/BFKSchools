import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'
import { ChildFactory } from '#database/factories/child_factory'
import type User from '#models/user'
import AccountLinkMail from '#mails/account_link_mail'
import type { BaseMail } from '@adonisjs/mail'

/** A school with one manager (staff must belong to a school for families). */
export async function setupSchool() {
  const school = await SchoolFactory.create()
  const manager = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
  return { school, manager }
}

/** A parent of `schoolId` (password set unless `invited`). */
export function createParent(schoolId: number, overrides: Partial<User> = {}) {
  return UserFactory.apply('parent')
    .merge({ schoolId, ...overrides } as Partial<User>)
    .create()
}

export function createChild(parent: User, overrides: Record<string, unknown> = {}) {
  return ChildFactory.merge({
    parentId: parent.id,
    schoolId: parent.schoolId!,
    ...overrides,
  }).create()
}

/** Raw token from an AccountLinkMail captured by the fake mailer. */
export function tokenOf(mail: BaseMail | undefined): string {
  if (!(mail instanceof AccountLinkMail)) throw new Error('Not an account link mail')
  return new URL(mail.url).pathname.split('/').pop()!
}

/** Path of the link in an AccountLinkMail. */
export function pathOf(mail: BaseMail | undefined): string {
  if (!(mail instanceof AccountLinkMail)) throw new Error('Not an account link mail')
  return new URL(mail.url).pathname
}

/** Whether the set-password page considers the link usable. */
export async function linkValid(
  client: { get: (url: string) => any },
  path: string
): Promise<boolean> {
  const response = await client.get(path).withInertia()
  return (response.inertiaProps as { valid: boolean }).valid
}
