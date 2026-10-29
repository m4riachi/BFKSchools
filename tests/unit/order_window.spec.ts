import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  checkSelection,
  cutoffFor,
  describeOption,
  evaluate,
  staffCanOverride,
  staffMayChangeDate,
  type DayOption,
  type SelectionInput,
  type WindowInput,
  type WindowSettings,
} from '#services/order_window_service'
import { APP_TIMEZONE } from '#support/time'

/**
 * OrderWindowService — table-driven (docs/PLAN.md Phase 6 acceptance).
 * Week of Mon 23 Nov 2026; deadline Sun 22 Nov 20:00 (D4); default cutoff
 * the day before at 18:00 (D5). All instants are wall-clock times in
 * Africa/Casablanca, built with the IANA zone (never an offset).
 */
const ZONE = APP_TIMEZONE
const at = (wall: string) => DateTime.fromISO(wall, { zone: ZONE })
const MON = '2026-11-23'
const TUE = '2026-11-24'
const WED = '2026-11-25'

const D5: WindowSettings = {
  allow_parent_edits: true,
  edit_mode: 'until_cutoff',
  edit_cutoff_days_before: 1,
  edit_cutoff_time: '18:00',
}

function input(
  overrides: Omit<Partial<WindowInput>, 'settings'> & { settings?: Partial<WindowSettings> } = {}
) {
  const { settings, ...rest } = overrides
  return {
    date: TUE,
    now: at('2026-11-20T12:00'),
    zone: ZONE,
    menu: { status: 'published' as const, orderDeadlineAt: at('2026-11-22T20:00') },
    hasMeals: true,
    isHoliday: false,
    isSchoolDay: true,
    child: { isActive: true },
    parent: { isActive: true },
    ...rest,
    settings: { ...D5, ...settings },
  } satisfies WindowInput
}

type Case = {
  title: string
  overrides: Omit<Partial<WindowInput>, 'settings'> & { settings?: Partial<WindowSettings> }
  allowed: boolean
  reason?: string
}

const CASES: Case[] = [
  // Before the deadline
  { title: 'open before the deadline', overrides: {}, allowed: true },
  {
    title: 'one minute before the deadline',
    overrides: { now: at('2026-11-22T19:59') },
    allowed: true,
  },
  // Kitchen lock: 1 minute before / at / 1 minute after the day cutoff (Mon 18:00 for Tue)
  { title: '1 min before the cutoff', overrides: { now: at('2026-11-23T17:59') }, allowed: true },
  {
    title: 'exactly at the cutoff',
    overrides: { now: at('2026-11-23T18:00') },
    allowed: false,
    reason: 'AFTER_CUTOFF',
  },
  {
    title: '1 min after the cutoff',
    overrides: { now: at('2026-11-23T18:01') },
    allowed: false,
    reason: 'AFTER_CUTOFF',
  },
  {
    title: 'before the deadline the cutoff does not lock (brief §5.6)',
    overrides: {
      now: at('2026-11-23T18:01'),
      menu: { status: 'published', orderDeadlineAt: at('2026-11-25T20:00') },
    },
    allowed: true,
  },
  {
    title: 'D5 defaults: Monday is still open on Sunday 19:00 (cutoff 18:00, deadline 20:00)',
    overrides: { date: MON, now: at('2026-11-22T19:00') },
    allowed: true,
  },
  {
    title: 'D5 defaults: Monday locks at the deadline (its cutoff already passed)',
    overrides: { date: MON, now: at('2026-11-22T20:00') },
    allowed: false,
    reason: 'AFTER_CUTOFF',
  },
  {
    title: 'mid-week deadline: today is orderable until the deadline',
    overrides: {
      now: at('2026-11-24T11:00'),
      menu: { status: 'published', orderDeadlineAt: at('2026-11-24T12:00') },
    },
    allowed: true,
  },
  // edit_cutoff_days_before = 0 (same day 09:00)
  {
    title: 'days_before 0: 1 min before 09:00 on the day',
    overrides: {
      now: at('2026-11-24T08:59'),
      settings: { edit_cutoff_days_before: 0, edit_cutoff_time: '09:00' },
    },
    allowed: true,
  },
  {
    title: 'days_before 0: 1 min after 09:00 on the day',
    overrides: {
      now: at('2026-11-24T09:01'),
      settings: { edit_cutoff_days_before: 0, edit_cutoff_time: '09:00' },
    },
    allowed: false,
    reason: 'AFTER_CUTOFF',
  },
  {
    title: 'days_before 0: the evening before is still open',
    overrides: {
      now: at('2026-11-23T18:30'),
      settings: { edit_cutoff_days_before: 0, edit_cutoff_time: '09:00' },
    },
    allowed: true,
  },
  // Around midnight Africa/Casablanca
  {
    title: '23:59 the day before (cutoff 00:00 on the day)',
    overrides: {
      now: at('2026-11-23T23:59'),
      settings: { edit_cutoff_days_before: 0, edit_cutoff_time: '00:00' },
    },
    allowed: true,
  },
  {
    title: '00:00 on the day (cutoff 00:00 on the day)',
    overrides: {
      now: at('2026-11-24T00:00'),
      settings: { edit_cutoff_days_before: 0, edit_cutoff_time: '00:00' },
    },
    allowed: false,
    reason: 'AFTER_CUTOFF',
  },
  {
    title: '23:58 with cutoff 23:59 the day before',
    overrides: { now: at('2026-11-23T23:58'), settings: { edit_cutoff_time: '23:59' } },
    allowed: true,
  },
  {
    title: '23:59 with cutoff 23:59 the day before',
    overrides: { now: at('2026-11-23T23:59'), settings: { edit_cutoff_time: '23:59' } },
    allowed: false,
    reason: 'AFTER_CUTOFF',
  },
  {
    title: 'Monday 23:59 for Monday is still today',
    overrides: {
      date: MON,
      now: at('2026-11-23T23:59'),
      settings: { edit_cutoff_days_before: 0, edit_cutoff_time: '23:59' },
    },
    allowed: false,
    reason: 'AFTER_CUTOFF',
  },
  {
    title: 'Tuesday 00:00: Monday is a past day',
    overrides: { date: MON, now: at('2026-11-24T00:00') },
    allowed: false,
    reason: 'PAST_DAY',
  },
  // After the deadline, per edit_mode
  {
    title: 'until_cutoff after the deadline, before the cutoff',
    overrides: { date: WED, now: at('2026-11-23T10:00') },
    allowed: true,
  },
  {
    title: 'allow_parent_edits = false after the deadline',
    overrides: { date: WED, now: at('2026-11-22T20:00'), settings: { allow_parent_edits: false } },
    allowed: false,
    reason: 'EDITS_DISABLED',
  },
  {
    title: 'allow_parent_edits = false before the deadline is open',
    overrides: { date: WED, now: at('2026-11-22T19:59'), settings: { allow_parent_edits: false } },
    allowed: true,
  },
  {
    title: 'same_day_only: today before the cutoff time',
    overrides: {
      now: at('2026-11-24T08:59'),
      settings: {
        edit_mode: 'same_day_only',
        edit_cutoff_days_before: 0,
        edit_cutoff_time: '09:00',
      },
    },
    allowed: true,
  },
  {
    title: 'same_day_only: a future day after the deadline',
    overrides: {
      now: at('2026-11-23T10:00'),
      settings: {
        edit_mode: 'same_day_only',
        edit_cutoff_days_before: 0,
        edit_cutoff_time: '09:00',
      },
    },
    allowed: false,
    reason: 'SAME_DAY_ONLY',
  },
  {
    title: 'same_day_only: today after the cutoff time',
    overrides: {
      now: at('2026-11-24T09:00'),
      settings: {
        edit_mode: 'same_day_only',
        edit_cutoff_days_before: 0,
        edit_cutoff_time: '09:00',
      },
    },
    allowed: false,
    reason: 'SAME_DAY_ONLY',
  },
  {
    title: 'same_day_only: before the deadline any day is open',
    overrides: {
      date: WED,
      now: at('2026-11-22T19:00'),
      settings: {
        edit_mode: 'same_day_only',
        edit_cutoff_days_before: 0,
        edit_cutoff_time: '09:00',
      },
    },
    allowed: true,
  },
  {
    title: 'same_day_only ignores edit_cutoff_days_before (today before 18:00)',
    overrides: { now: at('2026-11-24T08:00'), settings: { edit_mode: 'same_day_only' } },
    allowed: true,
  },
  // Locked days
  {
    title: 'past day',
    overrides: { date: MON, now: at('2026-11-24T08:00') },
    allowed: false,
    reason: 'PAST_DAY',
  },
  { title: 'holiday', overrides: { isHoliday: true }, allowed: false, reason: 'HOLIDAY' },
  {
    title: 'not a school day (weekday or school year)',
    overrides: { isSchoolDay: false },
    allowed: false,
    reason: 'NOT_SCHOOL_DAY',
  },
  {
    title: 'not a school day wins over a holiday',
    overrides: { isSchoolDay: false, isHoliday: true },
    allowed: false,
    reason: 'NOT_SCHOOL_DAY',
  },
  {
    title: 'D24: a day cancelled by staff is locked for the parent',
    overrides: { staffCancelled: true },
    allowed: false,
    reason: 'CANCELLED_BY_STAFF',
  },
  {
    title: 'a past holiday is a past day',
    overrides: { date: MON, isHoliday: true, now: at('2026-11-24T08:00') },
    allowed: false,
    reason: 'PAST_DAY',
  },
  {
    title: 'unpublished week (scheduled)',
    overrides: { menu: { status: 'scheduled', orderDeadlineAt: at('2026-11-22T20:00') } },
    allowed: false,
    reason: 'NOT_PUBLISHED',
  },
  {
    title: 'unpublished week (draft)',
    overrides: { menu: { status: 'draft', orderDeadlineAt: null } },
    allowed: false,
    reason: 'NOT_PUBLISHED',
  },
  { title: 'no menu at all', overrides: { menu: null }, allowed: false, reason: 'NOT_PUBLISHED' },
  {
    title: 'published day without meals',
    overrides: { hasMeals: false },
    allowed: false,
    reason: 'NO_MEALS',
  },
  {
    title: 'inactive child',
    overrides: { child: { isActive: false } },
    allowed: false,
    reason: 'INACTIVE',
  },
  {
    title: 'inactive parent',
    overrides: { parent: { isActive: false } },
    allowed: false,
    reason: 'INACTIVE',
  },
  {
    title: 'holiday wins over inactive',
    overrides: { isHoliday: true, child: { isActive: false } },
    allowed: false,
    reason: 'HOLIDAY',
  },
]

test.group('OrderWindowService.evaluate', () => {
  for (const item of CASES) {
    test(item.title, ({ assert }) => {
      const decision = evaluate(input(item.overrides))
      assert.equal(decision.allowed, item.allowed)
      assert.equal(decision.reason, item.allowed ? null : item.reason)
    })
  }

  test('the cutoff is a wall-clock time in the IANA zone', ({ assert }) => {
    const cutoff = cutoffFor(TUE, D5, ZONE)
    assert.equal(cutoff.setZone(ZONE).toFormat('yyyy-LL-dd HH:mm'), '2026-11-23 18:00')
    // same_day_only: the day itself at edit_cutoff_time (days_before ignored)
    const sameDay = cutoffFor(TUE, { ...D5, edit_mode: 'same_day_only' }, ZONE)
    assert.equal(sameDay.toFormat('yyyy-LL-dd HH:mm'), '2026-11-24 18:00')
  })

  test('a Ramadan date (offset change) keeps the wall-clock cutoff behaviour', ({ assert }) => {
    // 3 Mar 2026 is inside Ramadan 2026, 5 May 2026 is not; under older
    // tzdata both have different UTC offsets. The rule only uses wall clock.
    for (const date of ['2026-03-03', '2026-05-05']) {
      const dayBefore = DateTime.fromISO(date, { zone: ZONE }).minus({ days: 1 }).toISODate()!
      const base = {
        date,
        menu: {
          status: 'published' as const,
          orderDeadlineAt: at(`${dayBefore}T00:00`).minus({ days: 1 }),
        },
      }
      assert.isTrue(evaluate(input({ ...base, now: at(`${dayBefore}T17:59`) })).allowed, date)
      assert.equal(
        evaluate(input({ ...base, now: at(`${dayBefore}T18:01`) })).reason,
        'AFTER_CUTOFF',
        date
      )
      assert.equal(cutoffFor(date, D5, ZONE).toFormat('HH:mm'), '18:00')
    }
  })

  test('editableUntil is the cutoff with until_cutoff, the deadline when edits stop', ({
    assert,
  }) => {
    const open = evaluate(input())
    assert.equal(open.editableUntil!.toFormat('yyyy-LL-dd HH:mm'), '2026-11-23 18:00')
    const strict = evaluate(input({ settings: { allow_parent_edits: false } }))
    assert.equal(strict.editableUntil!.toFormat('yyyy-LL-dd HH:mm'), '2026-11-22 20:00')
    assert.isFalse(open.deadlinePassed)
  })

  test('staff may override time locks only', ({ assert }) => {
    for (const reason of ['PAST_DAY', 'AFTER_CUTOFF', 'EDITS_DISABLED', 'SAME_DAY_ONLY'] as const) {
      assert.isTrue(staffCanOverride(reason, 'save'))
    }
    for (const reason of ['HOLIDAY', 'NOT_PUBLISHED', 'NO_MEALS', 'INACTIVE'] as const) {
      assert.isFalse(staffCanOverride(reason, 'save'))
    }
    assert.isTrue(staffCanOverride('INACTIVE', 'cancel'))
    assert.isTrue(staffCanOverride('CANCELLED_BY_STAFF', 'save'))
    assert.isFalse(staffCanOverride('NOT_SCHOOL_DAY', 'save'))
  })

  test('D23: staff may change dates of the current month (school zone) or later', ({ assert }) => {
    assert.isTrue(staffMayChangeDate('2026-11-01', '2026-11-30'))
    assert.isTrue(staffMayChangeDate('2026-12-15', '2026-11-30'))
    assert.isFalse(staffMayChangeDate('2026-10-31', '2026-11-01'))
    assert.isFalse(staffMayChangeDate('2026-11-30', '2026-12-01'))
  })
})

/* ------------------------------------------------------------------ */

function option(overrides: Partial<DayOption> = {}): DayOption {
  return {
    menuItemId: 1,
    mealId: 10,
    mealType: 'subscription',
    isDefault: true,
    maxQuantity: null,
    mealAvailable: true,
    allergens: [],
    priceCents: 0, // D31: subscription meals are free
    orderedElsewhere: 0,
    ...overrides,
  }
}

const MAIN = option()
const MAIN_NUTS = option({
  menuItemId: 2,
  mealId: 11,
  isDefault: false,
  allergens: ['nuts', 'milk'],
})
const JUICE = option({
  menuItemId: 3,
  mealId: 20,
  mealType: 'supplement',
  isDefault: false,
  priceCents: 1000,
})
const COOKIE = option({
  menuItemId: 4,
  mealId: 21,
  mealType: 'supplement',
  isDefault: false,
  allergens: ['gluten'],
})
const CAPPED = option({
  menuItemId: 5,
  mealId: 12,
  isDefault: false,
  maxQuantity: 10,
  orderedElsewhere: 10,
})
const GONE = option({ menuItemId: 6, mealId: 13, isDefault: false, mealAvailable: false })
const OPTIONS = [MAIN, MAIN_NUTS, JUICE, COOKIE, CAPPED, GONE]

function selection(
  overrides: Omit<Partial<SelectionInput>, 'request' | 'rules'> & {
    request?: Partial<SelectionInput['request']>
    rules?: Partial<SelectionInput['rules']>
  } = {}
): SelectionInput {
  const { request, rules, ...rest } = overrides
  return {
    options: OPTIONS,
    existing: [],
    childAllergies: ['nuts'],
    hasSubscription: true,
    ...rest,
    request: { subscriptionMealId: 10, supplements: [], ...request },
    rules: { allergyRule: 'block', supplementMaxQuantity: 5, subscriptionRequired: true, ...rules },
  }
}

type SelCase = { title: string; input: SelectionInput; error: string | null }

const SELECTION_CASES: SelCase[] = [
  { title: 'a main meal of the day', input: selection(), error: null },
  {
    title: 'main + extras within the limit (D14: 5)',
    input: selection({ request: { supplements: [{ mealId: 20, qty: 5 }] } }),
    error: null,
  },
  {
    title: 'an extra above the limit',
    input: selection({ request: { supplements: [{ mealId: 20, qty: 6 }] } }),
    error: 'SUPPLEMENT_QUANTITY',
  },
  {
    title: 'an extra quantity of 0',
    input: selection({ request: { supplements: [{ mealId: 20, qty: 0 }] } }),
    error: 'SUPPLEMENT_QUANTITY',
  },
  {
    title: 'a meal not on the menu',
    input: selection({ request: { subscriptionMealId: 999 } }),
    error: 'MEAL_NOT_ON_MENU',
  },
  {
    title: 'an extra not on the menu',
    input: selection({ request: { supplements: [{ mealId: 999, qty: 1 }] } }),
    error: 'MEAL_NOT_ON_MENU',
  },
  {
    title: 'an extra sent as the main meal',
    input: selection({ request: { subscriptionMealId: 20 } }),
    error: 'WRONG_MEAL_TYPE',
  },
  {
    title: 'two subscription meals',
    input: selection({ request: { supplements: [{ mealId: 12, qty: 1 }] } }),
    error: 'TWO_SUBSCRIPTION_MEALS',
  },
  {
    title: 'the same extra twice',
    input: selection({
      request: {
        supplements: [
          { mealId: 20, qty: 1 },
          { mealId: 20, qty: 1 },
        ],
      },
    }),
    error: 'DUPLICATE_SUPPLEMENT',
  },
  {
    title: 'nothing selected',
    input: selection({ request: { subscriptionMealId: null } }),
    error: 'EMPTY_SELECTION',
  },
  {
    title: 'no subscription (D2) refuses a main meal',
    input: selection({ hasSubscription: false }),
    error: 'NO_SUBSCRIPTION',
  },
  {
    title: 'no subscription still allows extras (D2)',
    input: selection({
      hasSubscription: false,
      request: { subscriptionMealId: null, supplements: [{ mealId: 20, qty: 2 }] },
    }),
    error: null,
  },
  {
    title: 'pay-per-meal setting allows a main meal',
    input: selection({ hasSubscription: false, rules: { subscriptionRequired: false } }),
    error: null,
  },
  {
    title: 'allergy block (D9)',
    input: selection({ request: { subscriptionMealId: 11 } }),
    error: 'ALLERGY_BLOCKED',
  },
  {
    title: 'allergy block even with a confirmation',
    input: selection({ request: { subscriptionMealId: 11, confirmAllergy: true } }),
    error: 'ALLERGY_BLOCKED',
  },
  {
    title: 'warn_confirm without confirmation',
    input: selection({
      request: { subscriptionMealId: 11 },
      rules: { allergyRule: 'warn_confirm' },
    }),
    error: 'ALLERGY_CONFIRM_REQUIRED',
  },
  {
    title: 'warn_confirm with confirmation',
    input: selection({
      request: { subscriptionMealId: 11, confirmAllergy: true },
      rules: { allergyRule: 'warn_confirm' },
    }),
    error: null,
  },
  {
    title: 'an extra without the child allergen',
    input: selection({ request: { supplements: [{ mealId: 21, qty: 1 }] } }),
    error: null,
  },
  {
    title: 'max_quantity reached',
    input: selection({ request: { subscriptionMealId: 12 } }),
    error: 'SOLD_OUT',
  },
  {
    title: 'max_quantity: keeping an existing portion is fine',
    input: selection({
      request: { subscriptionMealId: 12 },
      existing: [{ menuItemId: 5, qty: 1 }],
      options: OPTIONS.map((o) => (o.menuItemId === 5 ? { ...o, orderedElsewhere: 9 } : o)),
    }),
    error: null,
  },
  {
    title: 'unavailable meal',
    input: selection({ request: { subscriptionMealId: 13 } }),
    error: 'MEAL_UNAVAILABLE',
  },
  {
    title: 'unavailable meal already in the order stays',
    input: selection({
      request: { subscriptionMealId: 13 },
      existing: [{ menuItemId: 6, qty: 1 }],
    }),
    error: null,
  },
]

test.group('OrderWindowService.checkSelection', () => {
  for (const item of SELECTION_CASES) {
    test(item.title, ({ assert }) => {
      const result = checkSelection(item.input)
      if (item.error === null) {
        assert.isTrue(result.ok, JSON.stringify(result))
      } else {
        assert.isFalse(result.ok)
        if (!result.ok) assert.equal(result.error, item.error)
      }
    })
  }

  test('SOLD_OUT reports the remaining portions', ({ assert }) => {
    const capped = option({
      menuItemId: 7,
      mealId: 30,
      mealType: 'supplement',
      isDefault: false,
      maxQuantity: 10,
      orderedElsewhere: 8,
    })
    const result = checkSelection(
      selection({
        options: [...OPTIONS, capped],
        request: { supplements: [{ mealId: 30, qty: 3 }] },
      })
    )
    assert.isFalse(result.ok)
    if (!result.ok) assert.deepEqual(result.values, { remaining: 2 })
  })

  test('describeOption gives the UI its flags', ({ assert }) => {
    const rules = {
      allergyRule: 'block' as const,
      supplementMaxQuantity: 5,
      subscriptionRequired: true,
    }
    const blocked = describeOption(MAIN_NUTS, {
      childAllergies: ['nuts'],
      hasSubscription: true,
      rules,
      existingQty: 0,
    })
    assert.deepEqual(blocked.allergyConflicts, ['nuts'])
    assert.isTrue(blocked.allergyBlocked)
    assert.equal(blocked.maxQty, 0)
    const sold = describeOption(CAPPED, {
      childAllergies: [],
      hasSubscription: true,
      rules,
      existingQty: 0,
    })
    assert.isTrue(sold.soldOut)
    assert.equal(sold.maxQty, 0)
    const juice = describeOption(JUICE, {
      childAllergies: [],
      hasSubscription: false,
      rules,
      existingQty: 2,
    })
    assert.equal(juice.maxQty, 5)
    assert.isFalse(juice.noSubscription)
    const main = describeOption(MAIN, {
      childAllergies: [],
      hasSubscription: false,
      rules,
      existingQty: 0,
    })
    assert.isTrue(main.noSubscription)
    assert.equal(main.maxQty, 0)
  })
})
