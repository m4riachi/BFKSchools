---
name: bfk-weekly-menus
description: "Phase 5 of BFK School Meals. Weekly menu builder, templates, menu status workflow, the scheduler and the automatic publication job. Use to implement Phase 5."
model: inherit
color: yellow
---

You build Phase 5. First read `docs/PROJECT_BRIEF.md` §5.4 and §6, then `docs/ERD.md`, `docs/PLAN.md`, `docs/STACK_NOTES.md`, `docs/DECISIONS.md` (D3, D4) and the existing code.

## Scope
1. **Migrations + models**: `weekly_menus`, `menu_items`, `menu_templates` (+ items, stored by weekday rather than by date). Add idempotency columns to `weekly_menus`: `reminder_sent_at`, `deadline_processed_at`.
2. **Week builder** (back-office):
   - pick a week (Monday); a grid of the school days;
   - per day, add subscription meals and supplements from the active meals;
   - exactly one default subscription meal per day that has subscription meals;
   - optional `max_quantity` per item;
   - holidays are greyed out and locked (use the holiday read API);
   - meal cards show the cover thumbnail, name, price and allergens.
3. **Copy previous week**, **save as template**, **apply template**: skip holiday days and inactive meals, and tell the admin what was skipped.
4. **Status workflow** — `draft → scheduled → published → closed`, plus `scheduled → draft`:
   - scheduling needs `publish_at`, `order_deadline_at` (deadline after publish) and at least one non-holiday day with meals;
   - `publish_at` and `order_deadline_at` are pre-filled from the school settings and editable per week;
   - a manual "publish now" action;
   - a published menu can receive new items, but **removing** an item from a published menu is blocked with a clear message in this phase. The impact flow (affected orders) is built in Phase 6.
5. **Scheduler**: set up the solution recommended in `docs/STACK_NOTES.md`. All commands are idempotent and use `Clock`:
   - `menus:publish-due` (every 5 min): publish each scheduled menu whose `publish_at` has passed → status `published`, set `published_at`, send an email + in-app notification to every active parent with an active child. Respect the notification setting, send in batches, log failures.
   - `menus:close-past` (daily): close menus whose week is over.
   - `menus:send-reminders` and `menus:apply-deadline`: register them in the schedule, but their order-dependent logic is finished in Phase 6 by `bfk-parent-ordering`. Make them no-ops with a clearly marked integration point.
   - schedule the yearly holiday command from Phase 4.
6. **`notifications` table** + a minimal service, `notify(user, type, data)`, used here and by later phases. The parent-facing notification list comes in Phase 8.
7. Document in `docs/STACK_NOTES.md` how the scheduler runs in development and in production.

## Tests
- Default-meal rule; holiday days locked
- Copy / template skipping
- Status transitions, valid and invalid
- Publish job with a frozen Clock: publishes only due menus, only once, and emails the right parents (fake mailer)
- Authorization

Follow the subagent rules and report format in `CLAUDE.md`.
