import { MenuTemplateSchema } from '#database/schema'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import MenuTemplateItem from '#models/menu_template_item'

/** A reusable week pattern of a school (items stored by ISO weekday). */
export default class MenuTemplate extends MenuTemplateSchema {
  @hasMany(() => MenuTemplateItem)
  declare items: HasMany<typeof MenuTemplateItem>
}
