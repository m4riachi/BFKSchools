/**
 * Shapes of the weekly menu builder props
 * (app/controllers/admin/weekly_menus_controller.ts).
 */
import type { MealSummary } from '~/components/meals/types'

export type MenuStatus = 'draft' | 'scheduled' | 'published' | 'closed'
export type MenuDayState = 'open' | 'holiday' | 'not_school_day'

export type MenuItemView = {
  id: number
  date: string
  type: 'subscription' | 'supplement' | string
  isDefault: boolean
  maxQuantity: number | null
  meal: MealSummary & { isDeleted: boolean }
}

export type MenuDayView = {
  date: string
  weekday: number
  state: MenuDayState
  holidayNames: string[]
  items: MenuItemView[]
}

export type MenuIssue =
  | { code: 'missing_times' | 'deadline_before_publish' | 'deadline_after_week' | 'no_open_day' }
  | { code: 'missing_default' | 'items_on_closed_day'; date: string }
  | { code: 'meal_unavailable'; date: string; mealId: number }

export type MenuCan = {
  addItems: boolean
  removeItems: boolean
  editItems: boolean
  editTimes: boolean
  replaceItems: boolean
  schedule: boolean
  unschedule: boolean
  publish: boolean
}

export type MenuReport = {
  kind: 'copy' | 'template_applied' | 'template_saved'
  added?: number
  skippedDays?: { date: string; reason: 'holiday' | 'not_school_day'; names: string[] }[]
  skippedMeals?: { date: string | null; mealId: number; nameFr: string; nameEn: string }[]
  newDefaults?: string[]
}

export type MenuTemplateView = {
  id: number
  name: string
  description: string | null
  itemsCount: number
}

export const STATUS_TONES: Record<MenuStatus, 'neutral' | 'info' | 'brand' | 'warning'> = {
  draft: 'neutral',
  scheduled: 'info',
  published: 'brand',
  closed: 'neutral',
}

/** Drag-and-drop payload type for catalog meals. */
export const MEAL_DRAG_TYPE = 'application/x-bfk-meal'
