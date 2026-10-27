# Project brief for Claude Code — BFK School Meals (Britech School)

You are building a production web application from scratch. Read this whole brief before writing any code. Start in **plan mode**: explore, propose the database schema and the phase plan, and wait for my approval before implementing Phase 1.

---

## 1. Context

**BFK Resto** is a restaurant company in Morocco. BFK has a partnership with **Britech School** (an international school that follows the **American school calendar**) to prepare the students' lunches.

We need one web application with two sides:

- **Back-office (BFK staff):** manage parents and children, the meal catalog, school holidays and weekly menus; follow orders; print kitchen production sheets.
- **Parent portal (customers):** each parent account has one or more children. BFK gives the parent access; the parent chooses the meals for each child, week by week, and can change a choice only within the rules configured by BFK.

---

## 2. Tech stack (mandatory)

- **AdonisJS 7** (TypeScript, latest stable). Check the official v7 docs (docs.adonisjs.com) for every API you use — do not assume v5/v6 syntax. Verify every third-party package is compatible with v7 before installing it.
- **PostgreSQL** + Lucid ORM (migrations, seeders, factories)
- **Inertia.js + Vue 3** (Composition API, `<script setup lang="ts">`) + **Tailwind CSS**
- VineJS (validation), Bouncer (policies), session auth (web guard)
- Drive for meal photos (local disk in dev, S3-compatible in prod) + `sharp` to generate WebP thumbnails
- Mail (invitations, notifications), i18n (FR + EN)
- A scheduler for automatic jobs (choose a v7-compatible option — scheduler package or Ace commands run by cron — and explain your choice)
- Luxon for dates, Japa for tests
- `docker-compose.yml` with PostgreSQL + Mailpit for local development

**Conventions**
- Timezone **Africa/Casablanca** everywhere.
- Business days (menu day, order day, holiday) are stored as PostgreSQL `date` columns, never as timestamps.
- Money in MAD: `numeric(10,2)` or integer centimes — pick one and stay consistent.
- snake_case in the DB, camelCase in models.
- Thin controllers; business logic in services; scheduled jobs call services.

---

## 3. Roles

| Role | Access |
|---|---|
| `admin` | Full back-office, users, settings |
| `manager` | Back-office except users and settings |
| `kitchen` | Read-only: daily production, allergy sheet, labels, exports |
| `parent` | Parent portal only, and only their own children |

Parents **cannot self-register**. Access is created by BFK (see §5.1).

---

## 4. Data model (proposal — refine it, show me the ERD before migrating)

- **users** — full_name, email (unique), phone, password, role, locale (fr/en), is_active, last_login_at
- **schools** — name, timezone, school_days (Mon–Fri by default), school_year_start, school_year_end, settings (jsonb). Seed one school: "Britech School". Keep `school_id` on related tables so a second school can be added later.
- **children** — parent_id → users, school_id, first_name, last_name, grade, class_name, allergies (jsonb list of allergen codes), dietary_notes, is_active
- **subscriptions** — child_id, start_date, end_date, status (active / paused / ended)
- **meals** — name_fr, name_en, description_fr, description_en, **type** enum `subscription | supplement`, category (main, starter, dessert, drink, snack), price, allergens (jsonb), tags (vegetarian…), is_active, soft delete (meals used by past orders must never be hard-deleted), external_recipe_ref (nullable, for a future link with BFK's central restaurant platform)
- **meal_photos** — meal_id, path, thumb_path, position, is_cover
- **holidays** — school_id, date, name, source enum `auto_us | auto_ma | import | manual`, is_active (lets an admin disable an auto-generated holiday without it coming back), unique(school_id, date, name)
- **weekly_menus** — school_id, week_start (Monday, unique per school), status enum `draft | scheduled | published | closed`, publish_at, order_deadline_at, published_at, notes, created_by
- **menu_items** — weekly_menu_id, date, meal_id, position, is_default (default meal of the day), max_quantity (nullable)
- **meal_orders** — child_id, date, weekly_menu_id, status (active / cancelled), cancel_reason, created_by, updated_by; unique(child_id, date)
- **meal_order_items** — meal_order_id, meal_id, menu_item_id, type, quantity, unit_price (**price snapshot at order time**)
- **order_audit_logs** — meal_order_id, actor_id, action, before (jsonb), after (jsonb), created_at
- **menu_templates** (+ items) — reusable week patterns
- **notifications** — in-app notices for parents

---

## 5. Features

### 5.1 Parents & children (back-office)
- CRUD parents; CRUD children under a parent (one parent → many children); manage each child's subscription.
- **Give access:** send an invitation email with a signed link (expires after 72 h) to set the password; resend invitation; activate / deactivate an account.
- CSV import of parents + children, with a preview and an error report before saving.
- Password reset flow for parents.

### 5.2 Meal catalog
- CRUD meals: name and description (FR/EN), type, price, category, allergens, tags, active flag; duplicate a meal.
- Several photos per meal: drag-and-drop upload, reorder, choose the cover, automatic thumbnails.
- Filters by type / category / active.

The two meal types:
- **Abonnement (subscription):** the main lunch included in the child's subscription. Maximum **one** subscription meal per child per day.
- **Supplément (supplement):** extra paid items (dessert, drink, snack…) added on top, with a quantity.

### 5.3 School holidays (American calendar)
- Holidays appear automatically in the back-office; admins can edit, disable, add or delete them.
- **Automatic generation:** an action "Generate holidays for school year YYYY–YYYY" plus a yearly scheduled job, computing **US federal holidays by rule** (no hardcoded dates), limited to the school year dates: Labor Day, Columbus / Indigenous Peoples' Day, Veterans Day, Thanksgiving + the Friday after, Christmas Day, New Year's Day, MLK Day, Presidents' Day, Memorial Day, Juneteenth. Re-running must be **idempotent** and must never re-create a holiday the admin disabled or deleted.
- Setting toggle to also generate **Moroccan fixed-date national holidays**: keep the list in a config file, verify it against the current official list, and let lunar holidays (Eids, etc.) be added manually.
- **School breaks** (winter break, spring break…): add as a date range (one row per school day) or **import from an ICS file or URL** (the school's calendar), with a preview before saving.
- Month calendar view + list view.
- Effect of a holiday: no menu, no ordering, nothing billed that day. If an admin adds a holiday on a date that already has orders → show how many orders are affected, ask for confirmation, cancel them (reason = holiday) and notify the parents.

### 5.4 Weekly menu configuration & automatic launch
- **Week builder:** grid of school days × meals; holidays shown greyed out and locked.
- For each day: choose the subscription meals offered (one or more) and the supplements available; mark one subscription meal as the **default** of the day.
- "Copy previous week", "Save as template", "Apply template".
- Each week has `publish_at` and `order_deadline_at`, pre-filled from settings (e.g. publish Thursday 10:00 of the previous week, deadline Sunday 20:00) and editable per week.
- **Automatic launch:** a scheduled job publishes every `scheduled` menu whose `publish_at` has passed → status `published`, ordering opens, all active parents receive an email + an in-app notice. Admins can also publish manually.
- **Reminder job:** X hours before the deadline, email the parents who still have children without a selection for that week.
- **At the deadline** (setting): for subscribed children with no choice → auto-assign the default meal of the day, or leave the day empty.
- Admins can still edit a published menu; if a meal that already has orders is removed, list the affected orders and ask how to handle them (switch to another meal / cancel + notify).

### 5.5 Parent portal (mobile-first)
- Login, FR/EN switch, change password.
- Child switcher (tabs / avatars) when the parent has several children.
- **Week view:** one card per day with meal photo, name, description, price and allergen badges. Day states: open / locked / holiday / not yet published.
- Choose the subscription meal (radio) + add supplements (quantity +/−) per day; option "no meal this day" (child absent); helper "apply the same choice to all my children".
- Week summary with the total per child and per family.
- **Allergy safety:** if a meal contains an allergen listed on the child's profile, show a clear warning and either block the selection or require explicit confirmation (admin setting).
- Order history and monthly statement (subscription meals + supplements, per child), printable / PDF.

### 5.6 Modification rules — CRITICAL, enforced on the server (not only in the UI)
- **Before the week's order deadline:** the parent can freely create and change selections for that week (except locked days).
- **After the deadline:** changes are allowed only if `allow_parent_edits = true`, and according to `edit_mode`:
  - `until_cutoff` — the parent can change the meal of any future day until that day's cutoff (`edit_cutoff_days_before` + `edit_cutoff_time`, e.g. same day 09:00).
  - `same_day_only` — the parent can only change **today's** meal, and only before `edit_cutoff_time`.
- Past days and holidays are always locked. Unpublished weeks are not orderable.
- Every create / change / cancel is written to `order_audit_logs` (who, when, before, after).
- Put all of this in one service (e.g. `OrderWindowService`) with full unit tests, including timezone edge cases: one minute before/after the cutoff, around midnight, a holiday, a week not yet published, a deactivated child or parent.

### 5.7 Back-office dashboard
- Today and tomorrow: quantity per dish, total supplements, children without a selection.
- Next week: publication status, % of children with a selection, countdown to the deadline.
- Upcoming holidays (next 30 days).
- Month-to-date amounts (subscription vs supplements).

### 5.8 Kitchen / production
- Daily production sheet: quantity per meal, breakdown by grade / class.
- Allergy sheet: children with allergies and their meal of the day, highlighted.
- Printable labels (child name, class, meal, allergens) as PDF.
- Excel / CSV exports (day, week, month) with filters: date range, class, meal type.

---

## 6. Settings screen (admin)
School days, school year start/end, default publish day + time, default order deadline, reminder delay, `allow_parent_edits`, `edit_mode`, `edit_cutoff_days_before`, `edit_cutoff_time`, auto-assign default meal on/off, allergy rule (block / warn + confirm), generate Moroccan holidays on/off, notification emails on/off.

---

## 7. Non-functional requirements
- **Authorization:** Bouncer policies everywhere; a parent can never read or modify another family's children or orders — write tests for this.
- VineJS validation on every endpoint; rate-limit login and password reset; CSRF on.
- FR + EN translations for every UI string and email; back-office in French by default.
- The parent portal must be excellent on phones.
- **Seeders** with realistic demo data: 1 school, ~20 meals with placeholder photos, 15 parents with 1–3 children each, 2 weeks of menus, holidays for the current school year, demo accounts for each role.
- **Tests (Japa):** order window rules, holiday generation (assert the computed dates for 2026–2027 and 2027–2028), holiday-induced cancellations, automatic publication, parent data isolation.
- **README:** setup, env vars, seeding, how to run the scheduler in production.
- Out of scope for now, but keep the design ready for: online payments / payment tracking, WhatsApp notifications, link with BFK's central restaurant platform (recipes, food cost).

---

## 8. Working method
The project is built with Claude Code subagents in `.claude/agents/` — one per phase, plus a QA agent and a security reviewer. `CLAUDE.md` describes the loop: phase agent → QA → security review → commit → summary to me → **stop and wait** for my go. My answers to business questions are kept in `docs/DECISIONS.md`.

**Phases**
0. Schema (Mermaid ERD), stack check and phase plan — wait for my approval
1. Project setup, Docker, auth, roles, base layouts (admin + kitchen + parent), i18n
2. Parents & children, subscriptions, invitations, CSV import
3. Meal catalog + photos
4. Holidays (auto generation, ICS import, calendar, CRUD)
5. Weekly menu builder + scheduler + automatic publication
6. Parent portal ordering + modification rules + audit log + order-dependent jobs (reminders, deadline auto-assign, holiday cancellations)
7. Dashboard + kitchen reports + exports + labels
8. Monthly statements + notification center + email templates
9. Hardening: test coverage, seed data, README, deployment notes

---

## 9. Open questions — tracked in `docs/DECISIONS.md`; ask me before the phase that needs the answer
- Is the subscription a fixed monthly fee, or is each subscription meal billed at its own price?
- Can a child without a subscription order meals (pay per meal), or only supplements?
- Exact default publish time, order deadline and edit cutoff.
- Does Britech School also close on Moroccan public holidays?
- Does the school publish an ICS calendar URL?
- Can one child be linked to two parent accounts (two guardians)?
