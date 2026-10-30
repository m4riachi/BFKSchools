import db from '@adonisjs/lucid/services/db'
import BusinessRuleException from '#exceptions/business_rule_exception'
import StaffRole from '#models/staff_role'
import User from '#models/user'
import {
  builtInPermissions,
  PERMISSIONS,
  roleForPermissions,
  type Permission,
} from '#enums/permissions'

const PG_UNIQUE_VIOLATION = '23505'

type RoleInput = { name: string; permissions: string[] }

/** Custom roles of a school (D42), and what a user may open. */
export default class StaffRoleService {
  /** Areas the user may open. */
  async permissionsOf(user: User): Promise<readonly Permission[]> {
    if (!user.staffRoleId) return builtInPermissions(user.role)
    const role = await StaffRole.find(user.staffRoleId)
    return (role?.permissions ?? []) as Permission[]
  }

  /** What every page needs to build its menu. */
  async accessOf(user: User) {
    if (!user.staffRoleId)
      return { permissions: [...builtInPermissions(user.role)], roleName: null }
    const role = await StaffRole.find(user.staffRoleId)
    return { permissions: (role?.permissions ?? []) as Permission[], roleName: role?.name ?? null }
  }

  async list(schoolId: number) {
    const roles = await StaffRole.query().where('school_id', schoolId).orderByRaw('lower(name)')
    const counts = await db
      .from('users')
      .where('school_id', schoolId)
      .whereNotNull('staff_role_id')
      .groupBy('staff_role_id')
      .select('staff_role_id', db.raw('count(*)::int AS total'))
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      permissions: role.permissions as string[],
      usersCount: Number(counts.find((row) => row.staff_role_id === role.id)?.total ?? 0),
    }))
  }

  find(schoolId: number, id: number) {
    return StaffRole.query().where('school_id', schoolId).where('id', id).firstOrFail()
  }

  async create(schoolId: number, input: RoleInput) {
    return this.uniqueName(() =>
      StaffRole.create({ schoolId, name: input.name, permissions: this.clean(input.permissions) })
    )
  }

  /** Its users change access level with it (a kitchen-only role has no back-office). */
  async update(role: StaffRole, input: RoleInput) {
    const permissions = this.clean(input.permissions)
    return this.uniqueName(() =>
      db.transaction(async (trx) => {
        role.useTransaction(trx)
        role.merge({ name: input.name, permissions })
        await role.save()
        await trx
          .from('users')
          .where('staff_role_id', role.id)
          .update({ role: roleForPermissions(permissions) })
        return role
      })
    )
  }

  async delete(role: StaffRole) {
    const used = await User.query().where('staff_role_id', role.id).first()
    if (used) throw new BusinessRuleException('users.errors.role_in_use')
    await role.delete()
  }

  /** In the menu's order, without duplicates. */
  protected clean(permissions: string[]) {
    return PERMISSIONS.filter((permission) => permissions.includes(permission))
  }

  protected async uniqueName<T>(work: () => Promise<T>) {
    try {
      return await work()
    } catch (error) {
      if ((error as { code?: string }).code !== PG_UNIQUE_VIOLATION) throw error
      throw new BusinessRuleException('users.errors.role_name_taken', { field: 'name' })
    }
  }
}
