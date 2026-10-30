# BFK School Meals — Claude Code guide

Web app for **BFK Resto × Britech School**: parents choose their children's weekly school lunches; BFK staff manage meals, holidays, weekly menus and kitchen production.

- Full specification: `docs/PROJECT_BRIEF.md` (source of truth for features)
- Schema and plan: `docs/ERD.md`, `docs/PLAN.md` (written in Phase 0)
- Business decisions: `docs/DECISIONS.md` (answers to open questions — always read it)
- Stack notes: `docs/STACK_NOTES.md` (AdonisJS 7 APIs and packages verified in Phases 0–1)

## Stack
AdonisJS 7 (TypeScript) · PostgreSQL · Lucid · Inertia + Vue 3 (`<script setup lang="ts">`) · Tailwind · VineJS · Bouncer · Drive + sharp · Mail · i18n (FR/EN) · Luxon · Japa · Docker (PostgreSQL + Mailpit)

## Commands
<!-- bfk-foundation fills this section in Phase 1; keep it accurate afterwards -->
- Setup: `npm install` · `cp .env.example .env` · `node ace generate:key` (Node ≥ 24)
- Start services: `docker compose up -d` (PostgreSQL with `bfk_dev` + `bfk_test`, Mailpit UI on :8025). Without Docker, point `DB_*` in `.env` at any PostgreSQL 16+ with both databases and `btree_gist`.
- Dev server: `npm run dev` (= `node ace serve --hmr`; port from `PORT` in `.env`; if busy it picks a random port — read the log)
- Migrations: `node ace migration:run` · rollback `node ace migration:rollback` · status `node ace migration:status` · reset `node ace migration:fresh --seed` (regenerates `database/schema.ts`)
- Seed: `node ace db:seed` — dev/test demo data (idempotent; demo seeders have `environment = ['development','test']` and `assertDemoSeeding()`, so production only gets `01_school_seeder`): Britech School (current school year), 194 meals (13 real subscription trays with photos from `database/demo/meal_photos/` + BFK's restaurant menu: 181 supplements from `database/catalog/`, inactive except `DEMO_ACTIVE_SUPPLEMENTS`), 15 parents (`parent@bfk.test` + 14 `@demo.bfk.test`), holidays + two breaks, menus from the previous month (closed, ordered) + current week (published, ordered, deadline processed) + next week (scheduled). Password `Demo1234!` for `admin@bfk.test`, `manager@bfk.test`, `kitchen@bfk.test`, `parent@bfk.test` and every demo parent with access; logins printed at the end. Helpers: `database/demo/support.ts` (`atInstant` freezes the Clock while seeding).
- Seed profiles in any environment (Railway etc.): `node ace bfk:seed catalog --email=… [--name= --role=]` (school + 13 trays + BFK restaurant menu as 181 inactive supplements (D32, `database/catalog/bfk_menu.ts` + `bfk_menu.json` + `bfk_menu_photos/`) + one staff account, password asked or `BFK_NEW_PASSWORD`) · `node ace bfk:seed demo` (everything; in production needs `ALLOW_DEMO_SEED=true` + `BFK_DEMO_PASSWORD`, demo accounts then use that password). The catalog code (05 seeder, `database/catalog/`) creates no account and has no `assertDemoSeeding()`; the build copies `database/demo/meal_photos/` and `database/catalog/` (adonisrc `metaFiles`).
- First admin in production: `node ace users:create-staff --email=… --name="…" --role=admin` (asks the password or reads `BFK_NEW_PASSWORD`).
- Docs for humans: `README.md` (setup, env vars, scheduler, tests) and `docs/DEPLOYMENT.md` (VPS + PM2 + nginx, cPanel, storage, backups, checklist).
- Tests: `npm test` (= `node ace test`; uses `.env.test` → `bfk_test`, memory session/limiter, fake mailer) · one suite `node ace test unit` / `node ace test functional` · one file `node ace test --files=tests/functional/auth.spec.ts`
- Typecheck / lint: `npm run typecheck` · `npm run lint` (`npx eslint . --fix` to auto-format)
- Codegen (routes/controllers/policies/pages indexes): `node ace codegen` (also runs on `serve`/`build`)
- Build: `npm run build` (= `node ace build` → `build/`; run with `cd build && npm ci --omit=dev && node bin/server.js`)
- File storage (meal photos): `DRIVE_DISK=fs` writes to `./storage` (gitignored; never served directly — photos go through `/media/meal-photos/:id/:variant`, logged-in users only). Production: `DRIVE_DISK=s3` + `S3_*` (any S3-compatible bucket, keep it private; see `.env.example`). Tests use `drive.fake('fs')`. Limits live in `config/meals.ts` (`MEAL_PHOTOS`).
- Holidays: `node ace holidays:generate` (all schools, or `--school=<id>`; idempotent, advisory-locked) generates the US federal holidays — and the Moroccan fixed-date ones when the school setting is on — for each school's configured year. Run daily by cron in production (see Scheduler below). Read API for later phases: `HolidayCalendar.isHoliday(schoolId, date)` / `holidaysBetween(schoolId, from, to)` (`app/services/holiday_calendar.ts`). Holiday lists/limits live in `config/holidays.ts`.
- Weekly menus (Phase 5): back-office `/admin/menus` (week list) and `/admin/menus/<Monday YYYY-MM-DD>` (builder). Services: `MenuBuilderService` (items, default dish, copy previous week, templates), `MenuStatusService` (draft → scheduled → published → closed, scheduled → draft; `canTransition`), `MenuPublicationService` (publish + notify), `MenuCalendar` (open days via HolidayCalendar, default publish/deadline times, readiness rules). In-app notices: `NotificationService.notify(user, type, data, { dedupeKey })`; bulk emails: `OutboxService.enqueue/enqueueMany` (mail classes registered by `mail_key` in `app/mails/outbox_registry.ts`).
- Scheduler (Phase 5, `docs/STACK_NOTES.md` §7 has the production crontab): Ace commands run by cron — `menus:publish-due` (*/5), `menus:send-reminders` and `menus:apply-deadline` (*/5, Phase 6), `mail:dispatch` (every minute; caps `MAIL_MAX_PER_RUN`/`MAIL_MAX_PER_HOUR`), `menus:close-past` (daily), `holidays:generate` (daily). All idempotent, advisory-locked, `Clock`-based. Dev: run one by hand, or `npm run scheduler:dev` (= `node ace scheduler:dev`, runs them every minute until Ctrl+C).
- Ordering (Phase 6): parent portal `/` (week view, `?child=&week=`), `/orders/history`; back-office `/admin/orders` (day list) and `/admin/orders/children/<id>?week=` (audited staff changes, reason required). Rules: `app/services/order_window_service.ts` (pure `evaluate` / `checkSelection` / `describeOption` — the only place ordering rules live); writes: `OrderService.saveDay/cancelDay/applyToChildren`; audit: `OrderAuditService`; jobs: `OrderDeadlineService` (reminders, D10 auto-assign); holiday cancellations: `HolidayImpactService`; published-menu changes (D18): `MenuChangeService` + impact page `/admin/menus/<week>/items/<id>/remove`.
- Reports (Phase 7): back-office dashboard `/admin` (`DashboardService`); kitchen area (admin, manager, kitchen — **GET routes only**) `/kitchen?date=` production sheet, `/kitchen/allergies`, `/kitchen/labels` + `/kitchen/labels/pdf` (pdfkit, fonts in `resources/fonts/`, grid = setting `label_grid`, max 1,200 labels per PDF), `/kitchen/exports` + `/kitchen/exports/download` (xlsx/csv, ≤ 366 days, ≤ 50,000 rows, prices for admin/manager only). All numbers come from `ProductionReportService` (SQL aggregations, active orders only); text cells of exports go through `safeCell()` (`app/support/spreadsheet_safety.ts`).
- Statements + notifications + emails (Phase 8): parent `/statements?month=YYYY-MM&child=` + `/statements/pdf`, `/notifications` (list, mark read / all, open, email preferences — only `menu_published` and `deadline_reminder` can be turned off: `OPT_OUTABLE_EMAILS` in `app/enums/menus.ts`); back-office `/admin/statements?month=` (all families, totals), `/admin/statements/export?month=` (xlsx), `/admin/statements/parents/<id>` (+ `/pdf`). Numbers: `StatementService` (snapshot `line_total_cents` of active orders, SQL sums; per D31 only supplements are billed, subscription meals are counted as "inclus"); PDF: `StatementPdfService` (pdfkit helpers in `app/support/pdf_text.ts`, every PDF behind `pdfRenderGate` in `app/support/render_gate.ts`, 2 at a time). Months: 2000-01 … next month (`app/support/statement_month.ts`); the current month and later are provisional. Emails: every mail extends `BrandedMail` (`app/mails/branded_mail.ts`) and renders `resources/views/emails/layout_html.edge` + `layout_text.edge`; the outbox re-checks the parent's opt-out when sending (`skipped: opted_out`). Unread badge: shared Inertia prop `unreadNotifications` (parents only, null otherwise).
- Parent account (Phase 9, D30): `/account` (details + change password: `PasswordChangeService`, current password checked on the locked row, bumps `credentials_version` → other sessions end, this one is re-bound; 5 tries / 15 min per user).
- Limits (Phase 9): PDFs behind `renderPdfForUser()` (`app/support/report_access.ts`: per-user gate 1 running + 1 waiting → 429, then the shared `pdfRenderGate` → 503); photo decodes behind `imageDecodeGate` (2); upload/import/change-password limiters in `start/limiter.ts` (`UPLOAD_LIMITS`). Redirect targets from data go through `isLocalPath()` (`app/support/safe_redirect.ts`).
- Settings (admin of the school only): `/admin/settings` (`SchoolSettingsService.updateFromForm`); managers get 403.
- Optional modules (D33): settings `allergens_enabled` / `labels_enabled` / `grade_enabled` / `class_enabled`, off by default. Server: `SchoolSettingsService.features(school)`, `effectiveAllergyRule()` in `OrderWindowService`. UI: shared Inertia prop `features`, `useFeatures()`, `usePlacement()`. `SchoolFactory` and `setupMenuSchool` turn them all on, so tests that want them off must say so.
- Mail in dev: `MAIL_MAILER=smtp` sends to Mailpit (127.0.0.1:1025); `MAIL_MAILER=log` (no SMTP server; dev/test only, refused in production) logs subject + masked recipient; add `MAIL_LOG_BODY=true` to also log the body (invitation/reset links). `MAIL_LOG_BODY` is ignored in production. Tests always use `mail.fake()`.

## Golden rules (never break)
1. Time zone is `Africa/Casablanca`, always through the IANA zone name — never a hard-coded offset like `+01:00` (Morocco's offset changes).
2. Business days (menu day, order day, holiday) are `date` columns handled as `YYYY-MM-DD` strings. Never `new Date()` / `Date.now()` in business logic — use the `Clock` service so tests can freeze time.
3. Ordering rules live only in `OrderWindowService` and are enforced on the server. The UI only displays what the server decides.
4. Prices come from the database and are snapshotted into `meal_order_items.unit_price`. Never trust a price, date, status or id sent by the browser without checking it.
5. Every route is authorized with Bouncer. A parent can only reach their own children, orders, statements and notifications.
6. Money is never computed with floats (use the format chosen in `docs/ERD.md`).
7. Meals used by orders are never hard-deleted (soft delete).
8. Every UI string and email goes through i18n (FR + EN). The back-office defaults to French.
9. Thin controllers → services → models. Scheduled jobs call services and are idempotent.
10. Check the official AdonisJS 7 docs before using an API; write anything surprising in `docs/STACK_NOTES.md`.

## How the work is delegated (main session)
Each phase has its own subagent in `.claude/agents/`. Phases run **one at a time** — never two builder agents in parallel (they touch the same files).

| Phase | Agent |
|---|---|
| 0 Schema, stack check, plan | `bfk-architect` |
| 1 Setup, Docker, auth, roles, layouts, i18n | `bfk-foundation` |
| 2 Parents, children, subscriptions, invitations, CSV import | `bfk-families` |
| 3 Meal catalog + photos | `bfk-meal-catalog` |
| 4 Holidays | `bfk-holidays` |
| 5 Weekly menus, scheduler, publication | `bfk-weekly-menus` |
| 6 Parent ordering, modification rules, order jobs | `bfk-parent-ordering` |
| 7 Dashboard + kitchen reports | `bfk-kitchen-dashboard` |
| 8 Statements, notifications, emails | `bfk-statements-notifications` |
| 9 Hardening, seeds, README, deployment | `bfk-hardening` |
| After every phase | `bfk-qa-tester`, then `bfk-security-reviewer` |

Loop for each phase:
1. Delegate to the phase agent: "Implement Phase N". Pass along any decisions the user made since the last phase.
2. If the agent returns **BLOCKED** with questions, ask the user, write the answers in `docs/DECISIONS.md`, then resume the same agent.
3. Run `bfk-qa-tester`, then `bfk-security-reviewer` on the phase's changes.
4. Failing checks or Critical/High findings → send them back to the phase agent (resume it), then repeat step 3.
5. Commit: `feat(phase-N): <summary>`.
6. Give the user a short summary and the manual test checklist, then **stop and wait** for their go.

Phase 0 is special: after `bfk-architect` returns, show the user the ERD, the plan and the decisions to confirm, and wait for approval before Phase 1.

## Rules for subagents
- You start without the conversation history. Before writing anything, read your sections of `docs/PROJECT_BRIEF.md`, then `docs/ERD.md`, `docs/PLAN.md`, `docs/DECISIONS.md`, `docs/STACK_NOTES.md` and the existing code.
- Stay inside your phase. If an earlier phase must change, make the smallest change and say so in your report.
- You cannot ask the user questions. When a business decision is missing and `docs/DECISIONS.md` has no default for it, stop and return `BLOCKED:` with the exact questions and your recommended answers.
- Do not commit — the main session commits after QA and review.
- Before returning, run migrations, typecheck, lint and tests yourself.
- Return this report: **Done** (what was built) · **Files** (main files touched) · **Migrations** · **Checks** (typecheck / lint / tests) · **Manual test checklist** · **Notes, risks, follow-ups for later phases**.
