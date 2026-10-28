---
name: bfk-parent-ordering
description: "Phase 6 of BFK School Meals, the critical one. Parent portal ordering, the OrderWindowService modification rules, the audit log, and the order-dependent jobs left by phases 4 and 5. Use to implement Phase 6."
model: inherit
color: red
---

You build Phase 6, the core of the product. First read `docs/PROJECT_BRIEF.md` §5.5, §5.6, §6 and §7, then `docs/ERD.md`, `docs/PLAN.md`, `docs/DECISIONS.md` (D1, D2, D5, D9, D10) and the existing code (Clock, holiday read API, menus, notifications).

## 1. Data
Migrations + models: `meal_orders` (unique child_id + date), `meal_order_items` (price snapshot), `order_audit_logs`.

## 2. `OrderWindowService` — the single source of truth
Write a pure core function, for example `evaluate({ date, now, menu, isHoliday, settings, child, parent, hasSubscription })` → `{ allowed, reason }`. The reason is an enum translated in the UI: `PAST_DAY`, `HOLIDAY`, `NOT_PUBLISHED`, `INACTIVE`, `NO_SUBSCRIPTION`, `EDITS_DISABLED`, `AFTER_CUTOFF`, `SAME_DAY_ONLY`…

Rules, checked in this order:
1. **Locked** when the date is before today, the date is a holiday, the date has no published menu, or the child or parent is inactive.
2. **Kitchen lock**: each day locks at its cutoff = (date − `edit_cutoff_days_before` days) at `edit_cutoff_time`, in Africa/Casablanca. Per D22 it applies only after the order deadline (brief §5.6).
3. **Before `order_deadline_at`**: creating, changing and cancelling are allowed (subject to rule 1 only).
4. **After the deadline**: allowed only if `allow_parent_edits` is true, and then:
   - `until_cutoff` → allowed until the day's cutoff;
   - `same_day_only` → allowed only when the date is today and now is before today's cutoff time.
   
   Creating an order for an empty day after the deadline follows the same rules as a change.

Compare times with Luxon in the `Africa/Casablanca` zone — never with a fixed offset.

## 3. `OrderService`
- `saveDay(child, date, { subscriptionMealId?, supplements: [{ mealId, qty }], confirmAllergy? }, actor)` runs in a transaction with a row lock on (child, date):
  - check `OrderWindowService`. Admins and managers may override, with a required reason, always audited;
  - every meal must be a `menu_items` entry of that date; at most one subscription meal; supplement quantity 1–5;
  - respect `max_quantity` across all orders, counted under a lock;
  - a subscription meal requires an active subscription covering the date (follow D2);
  - allergy check against the child's allergens: block, or require `confirmAllergy` (D9);
  - prices are snapshotted from the database;
  - write an audit row with before/after JSON and the actor (parent, staff or `system`).
- `cancelDay` ("no meal this day" / child absent) with the same checks. Cancelled orders are kept, not deleted.
- `applyToChildren(parent, date, selection, childIds)` validates each child separately and returns a result per child.

## 4. Parent portal (mobile-first)
- Week view with a child switcher.
- Day cards: photo, name, description, price, allergen badges, the day's state with its reason label, the default meal highlighted.
- Supplements with +/−, a "no meal this day" option.
- Week totals per child and per family; "same choice for all my children"; order history.
- The UI asks the server for each day's state. It never computes the rules itself.

## 5. Finish the integration points left by earlier phases
- `HolidayImpactService` (Phase 4): count and cancel orders on new holiday dates, notify the parents, audit as `system`.
- `menus:send-reminders` (Phase 5): X hours before the deadline (setting), email parents whose active children have no order on some open day of that week. Once per menu.
- `menus:apply-deadline` (Phase 5): when D10 is on, give each subscribed child with no order the default meal of each open day. Skip holidays, snapshot prices, audit as `system`. Once per menu.
- Removing an item from a published menu: show the affected orders, then switch them to another meal of that day, or cancel them and notify.
- Back-office: an orders list per day/week with filters; staff can view and edit a child's week (audited override).

## 6. Tests — must be thorough
- Table-driven `OrderWindowService` tests with a frozen Clock: 1 minute before and after the cutoff; 23:59 and 00:00 Africa/Casablanca; `edit_cutoff_days_before` 0 and 1; before and after the deadline with each `edit_mode`; `allow_parent_edits` false; past day; holiday; unpublished week; inactive child; inactive parent; no subscription.
- `OrderService`: meal not on the menu, two subscription meals, `max_quantity` race (two concurrent requests), allergy block / confirm, price snapshot unchanged after the meal's price is edited, audit rows written.
- Isolation: parent A cannot read, create, change or cancel for parent B's child — through direct requests and through `applyToChildren`.
- Jobs: reminders sent once, auto-assign runs once and only for subscribed children, holiday cancellation.

Follow the subagent rules and report format in `CLAUDE.md`.
