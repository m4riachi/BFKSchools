import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { DateTime } from 'luxon'
import type School from '#models/school'
import type User from '#models/user'
import WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import MenuPublicationService from '#services/menu_publication_service'
import MenuCalendar from '#services/menu_calendar'
import BusinessRuleException from '#exceptions/business_rule_exception'
import type { WeeklyMenuStatus } from '#enums/menus'
import { addDays, atLocalTime, type IsoDate } from '#support/dates'
import { schoolZone } from '#support/menu_display'

/**
 * Allowed status changes (brief §5.4, docs/PLAN.md Phase 5):
 * draft → scheduled, scheduled → draft, scheduled → published (job or
 * "publish now"), published → closed (job). Anything else is refused.
 */
export const MENU_TRANSITIONS: Record<WeeklyMenuStatus, readonly WeeklyMenuStatus[]> = {
  draft: ['scheduled'],
  scheduled: ['draft', 'published'],
  published: ['closed'],
  closed: [],
}

export type MenuTimesInput = {
  publishAt: DateTime
  orderDeadlineAt: DateTime
  notes?: string | null
}

/** Earliest publication: this many weeks before the menu's Monday (00:00, school zone). */
export const PUBLISH_MAX_WEEKS_BEFORE = 8

export function canTransition(from: WeeklyMenuStatus, to: WeeklyMenuStatus) {
  return MENU_TRANSITIONS[from].includes(to)
}

/**
 * Status workflow and publication times of a weekly menu. Every change
 * locks the menu row and checks the transition table; publication itself is
 * MenuPublicationService (shared with the `menus:publish-due` job).
 */
@inject()
export default class MenuStatusService {
  constructor(
    protected clock: Clock,
    protected calendar: MenuCalendar,
    protected publication: MenuPublicationService
  ) {}

  protected async locked<T>(menu: WeeklyMenu, work: (locked: WeeklyMenu) => Promise<T>) {
    return db.transaction(async (trx) => {
      const locked = await WeeklyMenu.query({ client: trx })
        .where('id', menu.id)
        .forUpdate()
        .firstOrFail()
      locked.useTransaction(trx)
      return work(locked)
    })
  }

  protected assertTransition(menu: WeeklyMenu, to: WeeklyMenuStatus) {
    if (!canTransition(menu.status, to)) {
      throw new BusinessRuleException('menus.errors.invalid_transition', {
        values: { from: menu.status, to },
      })
    }
  }

  /**
   * Edits this week's publish time and order deadline (pre-filled from the
   * settings). Allowed while the menu is a draft or scheduled.
   */
  async updateTimes(school: School, menu: WeeklyMenu, input: MenuTimesInput, actor: User) {
    return this.locked(menu, (locked) => this.applyTimes(school, locked, input, actor))
  }

  /**
   * Rules for a week's times, checked before anything is written:
   * - publication in the future (a past time would let the job publish at
   *   its next run without the readiness checks of "publish now") and at most
   *   `PUBLISH_MAX_WEEKS_BEFORE` weeks before the week starts;
   * - deadline after publication and before the week ends (school zone).
   */
  validateTimes(school: School, weekStart: IsoDate, input: MenuTimesInput) {
    if (input.publishAt <= this.clock.now()) {
      throw new BusinessRuleException('menus.errors.publish_in_past', { field: 'publishAt' })
    }
    const earliest = atLocalTime(
      addDays(weekStart, -7 * PUBLISH_MAX_WEEKS_BEFORE),
      '00:00',
      schoolZone(school)
    )
    if (input.publishAt < earliest) {
      throw new BusinessRuleException('menus.errors.publish_too_early', {
        field: 'publishAt',
        values: { weeks: PUBLISH_MAX_WEEKS_BEFORE },
      })
    }
    if (input.orderDeadlineAt <= input.publishAt) {
      throw new BusinessRuleException('menus.errors.deadline_before_publish', {
        field: 'orderDeadlineAt',
      })
    }
    if (input.orderDeadlineAt >= this.calendar.weekEndsAt(school, weekStart)) {
      throw new BusinessRuleException('menus.errors.deadline_after_week', {
        field: 'orderDeadlineAt',
      })
    }
  }

  /** Saves the times on a menu the caller has locked (inside its transaction). */
  async applyTimes(school: School, locked: WeeklyMenu, input: MenuTimesInput, actor: User) {
    if (!['draft', 'scheduled'].includes(locked.status)) {
      throw new BusinessRuleException('menus.errors.times_locked')
    }
    this.validateTimes(school, locked.weekStart, input)
    locked.merge({
      publishAt: input.publishAt,
      orderDeadlineAt: input.orderDeadlineAt,
      updatedBy: actor.id,
    })
    if (input.notes !== undefined) locked.notes = input.notes || null
    await locked.save()
    return locked
  }

  /** draft → scheduled, once every readiness rule passes. */
  async schedule(school: School, menu: WeeklyMenu, actor: User) {
    return this.locked(menu, async (locked) => {
      this.assertTransition(locked, 'scheduled')
      if (this.calendar.weekEndsAt(school, locked.weekStart) <= this.clock.now()) {
        throw new BusinessRuleException('menus.errors.week_over')
      }
      // A past publication time would make the job publish at its next run.
      if (locked.publishAt && locked.publishAt <= this.clock.now()) {
        throw new BusinessRuleException('menus.errors.publish_in_past')
      }
      const issues = await this.publication.issues(locked.$trx!, school, locked)
      if (issues.length) {
        throw new BusinessRuleException('menus.errors.not_ready', {
          values: { count: issues.length },
        })
      }
      locked.merge({ status: 'scheduled', updatedBy: actor.id })
      await locked.save()
      return locked
    })
  }

  /** scheduled → draft (back to editing; the job won't publish it). */
  async unschedule(menu: WeeklyMenu, actor: User) {
    return this.locked(menu, async (locked) => {
      this.assertTransition(locked, 'draft')
      locked.merge({ status: 'draft', updatedBy: actor.id })
      await locked.save()
      return locked
    })
  }

  /** "Publish now": scheduled → published right away (same path as the job). */
  async publishNow(menu: WeeklyMenu, actor: User) {
    const fresh = await WeeklyMenu.findOrFail(menu.id)
    this.assertTransition(fresh, 'published')
    const outcome = await this.publication.publish(menu.id, { origin: 'manual', actor })
    if (!outcome.published) {
      if (outcome.reason === 'week_over') {
        throw new BusinessRuleException('menus.errors.week_over')
      }
      if (outcome.reason === 'not_ready') {
        throw new BusinessRuleException('menus.errors.not_ready', {
          values: { count: outcome.issues?.length ?? 1 },
        })
      }
      throw new BusinessRuleException('menus.errors.invalid_transition', {
        values: { from: fresh.status, to: 'published' },
      })
    }
    return outcome
  }

  /** published → closed (the `menus:close-past` job, once the week is over). */
  async close(menu: WeeklyMenu) {
    return this.locked(menu, async (locked) => {
      this.assertTransition(locked, 'closed')
      locked.merge({ status: 'closed', closedAt: this.clock.now() })
      await locked.save()
      return locked
    })
  }
}
