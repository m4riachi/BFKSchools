import { MenuTemplateItemSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Meal from '#models/meal'

export default class MenuTemplateItem extends MenuTemplateItemSchema {
  @belongsTo(() => Meal)
  declare meal: BelongsTo<typeof Meal>
}
