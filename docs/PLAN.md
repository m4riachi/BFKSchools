# BFK School Meals — phase plan

Source of truth for features: `docs/PROJECT_BRIEF.md`. Schema: `docs/ERD.md`. Stack: `docs/STACK_NOTES.md`. Decisions: `docs/DECISIONS.md`.
Phases run one at a time; after each: `bfk-qa-tester` → `bfk-security-reviewer` → commit → user approval (see `CLAUDE.md`).
Acceptance criteria are written so each one maps to at least one automated test or one manual check ("[manual]").

## Dependency overview

```
0 ─► 1 ─► 2 ─► 3 ─► 4 ─► 5 ─► 6 ─► 7 ─► 8 ─► 9
          │    │    │    │    ▲
          │    │    │    └────┤ (5 needs 3 meals, 4 holiday read API, 2 parents for emails)
          │    │    └─────────┤ (4 HolidayImpactService stub → finished in 6)
          │    └──────────────┘
          └ children/subscriptions needed by 5 (recipients) and 6 (ordering)
```
Phases 3 and 4 are independent of each other but run sequentially (one builder at a time).

---

## Phase 1 — Setup, Docker, auth, roles, layouts, i18n
**Agent:** `bfk-foundation` · **Depends on:** Phase 0 approved.
**Tables:** `schools`, `users`, `remember_me_tokens` (auth stub), `rate_limits` (limiter database store).
**Scope:** scaffold with the Vue kit (`npm create adonisjs@latest -- --kit=vue`), switch to PostgreSQL, remove signup + `better-sqlite3`, add Tailwind v4, align Inertia/Vite majors (STACK_NOTES §1); docker-compose (PostgreSQL + test DB + Mailpit); `TZ`, Luxon default zone, pg OID-1082 parser, Lucid `schema_rules.ts` for `date`/`text[]`/`jsonb`; `Clock` service + freeze helper; MAD and ISO-date helpers; `SchoolSettingsService` (defaults from ERD, deep merge, Vine schema); auth (login/logout/remember me, rate-limited, inactive blocked on every request); Bouncer abilities + policy folder; role middleware + redirects; three layouts + shared UI components; i18n FR/EN with locale from user/cookie, shared to Inertia + client formatter; Shield; `CLAUDE.md` commands; seed 1 school + 1 user per role.
**Acceptance criteria:**
- `docker compose up -d` starts PostgreSQL and Mailpit; `node ace migration:run` and `node ace db:seed` succeed on an empty DB.
- A valid login redirects admin/manager → `/admin`, kitchen → `/kitchen`, parent → `/`; a wrong password shows a translated error.
- The 6th failed login within one minute for the same email+IP is refused with a "too many attempts" message.
- A user with `is_active = false` cannot log in, and an already logged-in user who is deactivated is logged out on their next request.
- A parent gets 403 on `/admin/*` and `/kitchen/*`; kitchen gets 403 on `/admin/*` except routes explicitly opened later.
- A `date` column written as `'2027-03-28'` reads back as the string `'2027-03-28'` (including around Morocco's DST switches).
- With the Clock frozen at `2026-11-02T08:59 Africa/Casablanca`, `clock.today()` returns `'2026-11-02'` and `clock.now().toISO()` carries the Casablanca offset.
- `SchoolSettingsService.get()` returns every key of ERD §schools.settings with its default when `settings = '{}'`.
- Switching the locale to EN changes UI strings on the next page; no hard-coded UI strings in Vue files [manual + grep].
- Typecheck, lint and tests pass; `CLAUDE.md` Commands section is filled.

## Phase 2 — Parents, children, subscriptions, invitations, CSV import
**Agent:** `bfk-families` · **Depends on:** 1.
**Tables:** `children`, `subscriptions`, `user_tokens` (+ `btree_gist` extension, or the documented fallback).
**Scope:** brief §5.1; agent file. Child visibility only through `Child.visibleTo(user)` / `ChildPolicy` (D8 switch point).
**Acceptance criteria:**
- Staff can create/edit/deactivate parents and their children; validation errors are shown per field in the user's language.
- Allergies outside the EU-14 list are rejected (VineJS and DB check).
- Creating a subscription that overlaps another period of the same child is rejected.
- An invitation email (Mailpit / fake mailer) contains a link that sets the password once; the same link fails the second time; a link older than 72 h fails; after "resend", the previous link fails and the new one works.
- The raw token is never stored: `user_tokens.token_hash` is a 64-char hex SHA-256.
- Password reset returns the same response and timing class for existing and unknown emails; the reset endpoint is rate-limited.
- CSV import shows a preview with row-level errors, saves nothing until confirmed, saves everything in one transaction, groups rows by parent email, and a second import of the same file creates no duplicates.
- A parent requesting any `/admin` route gets 403; kitchen has no access to this area.

## Phase 3 — Meal catalog + photos
**Agent:** `bfk-meal-catalog` · **Depends on:** 1.
**Tables:** `meals`, `meal_photos`.
**Scope:** brief §5.2; Drive fs (dev) / s3 (prod) + sharp WebP (full ≤1600 px + 400 px thumb); duplicate meal; filters; soft delete via `deleted_at` + explicit scopes.
**Acceptance criteria:**
- Staff can create, edit, duplicate, deactivate and delete meals; a deleted meal disappears from the catalog and the menu builder picker but its row remains (`deleted_at` set).
- Prices are entered as MAD with up to 2 decimals and stored as integer centimes (e.g. "12,50" → 1250); no float math in code [review].
- Uploading a JPEG/PNG creates a WebP and a WebP thumbnail on the configured disk (fake disk in tests); non-images and files over the size limit are rejected.
- Photos can be reordered; exactly one photo is the cover after any add/remove/cover change; deleting a photo deletes both files.
- Filters by type, category and active return the right rows.
- `meals.type` cannot be changed once the meal is used on a menu (enforced after Phase 5; documented).
- Kitchen and parents cannot reach catalog write routes.

## Phase 4 — Holidays
**Agent:** `bfk-holidays` · **Depends on:** 1 (schools, settings). 
**Tables:** `holidays`.
**Scope:** brief §5.3; agent file. Generation with `rule_key` + tombstones; ranges via `group_id`; Moroccan fixed holidays from `config/` (sourced) behind `generate_moroccan_holidays`; ICS file/URL import with SSRF guard; calendar + list; `isHoliday` / `holidaysBetween` API; `holidays:generate` Ace command; `HolidayImpactService` **stub**.
**Acceptance criteria:**
- `UsHolidayCalculator` returns exactly the dates in the `bfk-holidays` table for 2026–2027 and 2027–2028 (incl. observed Friday/Monday rules).
- Generating twice creates no duplicates; a generated holiday that was disabled or deleted is not re-created on the next run.
- Only dates that are school days inside the school year are generated.
- A range "Winter break 2026-12-21 → 2027-01-01" creates one row per school day (no weekend rows) with one shared `group_id`, and can be renamed/deleted as one group.
- ICS fixture import previews all-day events as ranges, flags duplicates, and imports only checked rows with `source = 'import'`.
- URL import refuses `http://`, `https://127.0.0.1`, `https://10.x`, `https://169.254.169.254`, a redirect to a private address, bodies above the size limit, and slow responses (timeout).
- When generate_moroccan_holidays is off, no `auto_ma` rows are created.
- `countAffectedOrders()` returns 0 (stub), and the "add holiday" UI shows the confirmation step when the count is > 0 [unit test with a mocked service].

## Phase 5 — Weekly menus, scheduler, publication
**Agent:** `bfk-weekly-menus` · **Depends on:** 2 (recipients), 3 (meals), 4 (holiday API).
**Tables:** `weekly_menus`, `menu_items`, `menu_templates`, `menu_template_items`, `notifications`, `outbound_emails`.
**Scope:** brief §5.4; agent file. Scheduler = Ace commands + cron, advisory lock, `Clock` (STACK_NOTES §7). Commands: `menus:publish-due`, `menus:close-past`, `mail:dispatch`, and **no-op stubs** `menus:send-reminders`, `menus:apply-deadline` (finished in 6); schedule `holidays:generate`. `NotificationService.notify()` and `OutboxService.enqueue()`.
**Acceptance criteria:**
- A day with subscription meals must have exactly one default before the menu can be scheduled; holiday days can't receive items.
- Copy previous week / apply template skip holidays and inactive or deleted meals and report what was skipped.
- `publish_at` / `order_deadline_at` are pre-filled from settings (Thursday 10:00 / Sunday 20:00 of the previous week, Africa/Casablanca) and the deadline must be after publish.
- Valid transitions: draft→scheduled, scheduled→draft, scheduled→published (job or manual), published→closed; any other transition is refused.
- With the Clock frozen just after `publish_at`, `menus:publish-due` publishes that menu only, sets `published_at`, creates one notification and one outbox email per active parent with an active child; running it again creates nothing new.
- With `email_notifications.enabled = false`, notifications are created but no emails.
- `mail:dispatch` sends pending emails (fake mailer), marks them `sent`, retries failures with backoff and stops at `failed` after 5 attempts.
- Removing an item from a **published** menu is refused with a clear message (impact flow comes in 6); adding items is allowed.
- Two overlapping runs of a command don't both execute (advisory lock).
- Parents and kitchen cannot reach the menu builder.

## Phase 6 — Parent ordering, modification rules, order jobs
**Agent:** `bfk-parent-ordering` · **Depends on:** 2, 3, 4, 5.
**Tables:** `meal_orders`, `meal_order_items`, `order_audit_logs`.
**Scope:** brief §5.5, §5.6; agent file. `OrderWindowService` (pure), `OrderService` (`saveDay`, `cancelDay`, `applyToChildren`), parent portal week view, back-office orders + audited overrides.

**Order-dependent parts of Phases 4 and 5 that are finished here:**
1. **Holiday cancellations** — complete `HolidayImpactService.countAffectedOrders/cancelAffectedOrders`: cancel active orders on the new holiday dates (`cancel_reason = 'holiday'`, audit `holiday_cancel` as system), notify parents (notification + outbox, not opt-out-able).
2. **Deadline reminders** — implement `menus:send-reminders`: when `now >= order_deadline_at − reminder_hours_before_deadline` and `reminder_sent_at` is null, email parents with an active child lacking an order row on some open day; set `reminder_sent_at`; dedupe per parent.
3. **Auto-assign at the deadline** — implement `menus:apply-deadline`: when `now >= order_deadline_at` and `deadline_processed_at` is null and `auto_assign_default_meal` (D10) is on, create an order with the day's default meal for every active child with a covering active subscription and **no order row** (a cancelled "absent" row counts as a choice) on every open non-holiday day; snapshot prices; audit `auto_assign`; skip days whose default is sold out (`max_quantity`) and report them; set `deadline_processed_at`.
4. **Removing a meal from a published menu** — replace the Phase 5 refusal with the impact flow: list affected active orders, then switch them to another meal of that day or cancel them (`menu_change`), notify parents, set `menu_items.removed_at`.

**Acceptance criteria:**
- Table-driven `OrderWindowService` tests pass for: 1 min before/after the day cutoff; 23:59 and 00:00 Africa/Casablanca; `edit_cutoff_days_before` 0 and 1; before/after the deadline for each `edit_mode`; `allow_parent_edits = false`; past day; holiday; unpublished week; inactive child; inactive parent; no subscription (D2) — each returns the expected `{ allowed, reason }`.
- A tested date inside Morocco's Ramadan offset change gives the same wall-clock cutoff behaviour as outside it.
- `saveDay` rejects a meal not on that day's menu, two subscription meals, a supplement quantity above `supplement_max_quantity`, and a meal containing one of the child's allergens (D9 `block`), and accepts it with `confirmAllergy` when `allergy_rule = 'warn_confirm'`.
- Two concurrent `saveDay` calls for the last unit of a `max_quantity` item: exactly one succeeds.
- Editing a meal's price after ordering does not change `meal_order_items.unit_price_cents` of existing items.
- Every create/update/cancel/override writes one `order_audit_logs` row with actor, before and after; staff overrides without a reason are refused.
- Parent A cannot read, create, change or cancel orders of parent B's child via direct requests or `applyToChildren` (403/404 and no DB change).
- The four integration points above each have a job test: reminders sent once; auto-assign runs once and only for subscribed children without an order row; holiday cancellation cancels and notifies; menu-item removal switches or cancels the affected orders.
- The parent week view renders on a 375 px wide screen without horizontal scroll, and each locked day shows its translated reason [manual].

## Phase 7 — Dashboard, kitchen reports, exports, labels
**Agent:** `bfk-kitchen-dashboard` · **Depends on:** 6.
**Tables:** none (index migrations only if `EXPLAIN` shows the need).
**Scope:** brief §5.7, §5.8; `ProductionReportService` (SQL aggregations), dashboard, kitchen area, labels PDF (pdfkit), Excel (exceljs) / CSV (csv-stringify) exports with formula-injection escaping.
**Acceptance criteria:**
- On seeded data, production quantities per meal per day equal the sum of active order items (cancelled orders excluded; holiday days empty), with correct grade/class breakdown.
- The allergy sheet lists exactly the children whose `allergies` overlap their meal's `allergens`, plus children with allergies or dietary notes, highlighted.
- Dashboard numbers (today/tomorrow, next week % with selection, upcoming holidays, month-to-date subscription vs supplement totals in centimes) match hand-computed fixtures.
- Labels PDF is a non-empty A4 PDF with one label per active order, 3×8 by default, sorted by class then name.
- Excel and CSV exports have the expected row counts per filter; a cell value `=1+1` is exported as text (escaped).
- Kitchen can read but every write route returns 403; parents get 403 on all of it.
- No N+1: each report runs a bounded number of queries [test with query counting or review].

## Phase 8 — Statements, notification center, emails
**Agent:** `bfk-statements-notifications` · **Depends on:** 6 (orders), 5 (notifications/outbox), 7 (PDF library choice).
**Tables:** none expected (statements are derived; payment tables only if D11 = yes).
**Scope:** brief §5.4/§5.5 notifications and statements; agent file; final FR/EN email templates + shared layout; `notification_prefs` opt-outs (cancellations can't be opted out).
**Acceptance criteria:**
- A monthly statement equals the sum of `line_total_cents` of the child's active orders that month; a mid-month price change uses the snapshots; cancelled and holiday days contribute 0; family total = sum of children.
- ~~With `billing_mode = 'monthly_fee'` the subscription lines show the fee instead~~ — obsolete (D31: subscription meals are free; statements bill supplements only and count subscription meals as "included").
- The statement PDF downloads and is non-empty; a parent requesting another family's statement gets 403/404.
- Notification list shows newest first with an unread badge; mark one / mark all as read work.
- Every email (invitation, reset, menu published, reminder, holiday cancellation, order changed by staff, menu change) renders in FR and EN with HTML + text parts and a correct link (fake mailer).
- A parent who opted out of reminders receives none; they still receive cancellations.
- A failing SMTP send is logged and never fails the user's request.

## Phase 9 — Hardening, seeds, README, deployment
**Agent:** `bfk-hardening` · **Depends on:** 1–8.
**Tables:** none (possibly indexes).
**Scope:** brief §7; full demo seed (1 school, ~20 meals with placeholder photos, 15 parents × 1–3 children, 2 weeks of menus, current-year holidays, one account per role); coverage gaps; README (setup, env vars, seeding, crontab for the scheduler, build/deploy); deployment notes for cPanel **and** a Docker/VPS fallback (Node 24 requirement).
**Acceptance criteria:**
- `node ace migration:fresh --seed` on an empty DB produces the demo data above and every demo account can log in.
- The whole test suite passes; tests exist for every item in brief §7 "Tests".
- README lets a new developer go from clone to running app + scheduler with only the documented commands [manual].
- `node ace build` output runs with `node bin/server.js` and the crontab lines from STACK_NOTES §7 [manual].
- Security headers, CSRF, rate limits and secure cookies are active in production mode [manual + test].

---

## Decisions to confirm before Phase 1
Listed in the Phase 0 report; defaults are already in ERD settings, so Phase 1 is not blocked by D1–D11 except where noted.

## Deferred review follow-ups (Low, for Phase 9 unless a phase touches the code first)
Status after Phase 9: ~~struck~~ = done (where); **open** = left on purpose, with the reason.

- ~~Phase 1: TRUST_PROXY public-range check uses sample IPs only~~ — done in Phase 9 (`trustProxyEntryIssue`: private blocks any size; public ranges need ≥ /12 IPv4, ≥ /28 IPv6, so Cloudflare's ranges pass and `0.0.0.0/1`, `2000::/3`, `::ffff:0:0/96` fail).
- ~~Phase 2: `setPassword` vs `issue()` lock order~~ — done in Phase 9 (setPassword finds the token's owner without a lock, locks the user, then consumes the token: user → tokens everywhere).
- ~~Phase 2: `invite()` checks before the transaction~~ — done in Phase 9 (re-checked on the row locked `FOR UPDATE`).
- ~~Phase 2: `DeferredTasks` cap, SMTP timeouts, drain timeout~~ — done in Phase 9 (100 pending max, then dropped + logged; `drain(15 s)`; SMTP connection/greeting 10 s, socket 30 s).
- ~~Phase 2: mail error logs may contain the full recipient~~ — done in Phase 9 (deferred tasks, queued-mail and import invitation logs use `safeErrorCode`/`safeMailError`; logger `redact` for passwords/tokens/cookies).
- ~~Phase 2: sessions without `auth_cv` adopt the version~~ — done in Phase 9 (adopt only when `viaRemember`; `endSession()` forgets it on logout).
- ~~Phase 2: no DB constraint `children.school_id` = parent's school~~ — done in Phase 9 (composite FK `children_parent_school_fk`).
- ~~Phase 2: import errors and 403-vs-404 reveal other schools~~ — done in Phase 9 (parents/children/subscriptions looked up inside the staff member's school → 404; one generic "address already used" import error).
- Phase 2: import confirm sends invitations synchronously; upload limits — **partly done** (tmp upload file deleted, ≤ 5 pending previews per user, invitations stop after 3 consecutive SMTP failures, SMTP timeouts). **Open:** the route-level 1 MB multipart limit (global bodyparser limit is 20 MB) — enforced at the reverse proxy instead (`client_max_body_size 2m`, docs/DEPLOYMENT.md); accepted risk (admin-only route).
- Phase 2: import row errors prefixed with raw column keys — **open, intended**: the keys are the CSV headers the admin typed (template columns), so they point at the right column.
- ~~Phase 3: media route has no Bouncer check~~ — done in Phase 9 (`MealPolicy.viewPhoto`: staff/kitchen all; parents only meals on a published/closed menu of their school or in their children's orders; else 404).
- ~~Phase 3: upload limits at the proxy, sharp concurrency, upload rate limit~~ — done in Phase 9 (nginx/Apache limits documented in docs/DEPLOYMENT.md; `imageDecodeGate` 2 decodes + 10 waiting; 20 upload requests / 10 min per user).
- Phase 3: sharp `failOn` / `money.ts` / https `S3_ENDPOINT` — `money.ts` length guard ~~done~~ (Phase 9, 32 chars); https `S3_ENDPOINT` ~~done~~ (Phase 3 fix). **Open:** `failOn: 'error'` kept — `'warning'` rejects many slightly malformed phone JPEGs; decoding is still bounded (pixel limit, magic bytes, format match, re-encode).
- ~~Phase 3: `new Date()` in `meal_photo_service.ts`~~ — done in Phase 9 (Clock).
- ~~Phase 5: meal type lock is check-then-save~~ — done in Phase 5.
- ~~Phase 3 (Medium): CSP `img-src` blocks the S3 redirect~~ — done in Phase 3 fix (bucket origin in the CSP).
- ~~Phase 6 (Medium): recount inside the transaction; order creation takes the school lock~~ — done in Phase 6.
- ~~Phase 4: rate-limit ICS imports; purge previews; cap pending~~ — done in Phase 9 (10 imports / 10 min per user; previews purged on every upload, ≤ 5 per user; tmp upload deleted). No separate purge cron (previews only appear on upload, which purges).
- ~~Phase 4: `updateOne`/`updateGroup`/`setActive` decide on rows read before the lock~~ — done in Phase 9 (re-read `FOR UPDATE` inside the lock; a range changed meanwhile → "reload and try again").
- Phase 4: ICS screener vs node-ical TZID quote stripping; overrides with their own RRULE — **open, accepted risk**: contained by the parsed-authority re-check, the worker's memory/time limits and the 400-occurrence cap.
- ~~Phase 4: `sanitizeParseResult` rejects > 1,000 ignored entries~~ — done in Phase 9 (sliced to 1,000).
- ~~Phase 3 S3 CSP fail-closed edge cases~~ — done in Phase 9 (boot-time presign self-check in production: the app refuses to start when the signed URL's origin differs from the CSP's). Still do one manual photo check on the real bucket (DEPLOYMENT checklist).
- ~~Phase 6: published-menu item changes, max below ordered, meal availability~~ — done in Phase 6.
- ~~Phase 5: a menu can be published after its order deadline~~ — done in Phase 6 (D19).
- ~~Phase 6: deactivating a child does not cancel its future orders~~ — done in Phase 6.
- ~~Phase 6: the media route serves any photo to any logged-in user~~ — done in Phase 9 (`MealPolicy.viewPhoto`, above).
- Phase 6: `auto_assigned` notifications are in-app only — **open, needs a decision** (add an `auto_assigned` email key + opt-out if BFK wants it).
- Phase 5: daily jobs decide "week over" with the app time zone — **open, accepted**: one school in Africa/Casablanca; revisit before adding a school in another zone.
- ~~Phase 5: hourly mail cap counts only sent rows~~ — done in Phase 9 (failed SMTP attempts in the last hour count too; skipped rows don't).
- ~~Phase 5: `SchoolPolicy.view` treats staff without a school as all schools~~ — done in Phase 9 (aligned: own school only).
- ~~Phase 6 review (Medium): order date not checked as a school day~~ — done (6e451b0: `NOT_SCHOOL_DAY`).
- ~~Phase 6 review (Medium): removing a published default promotes a new default without D18~~ — done in Phase 6 fix (deadline check + parent notification).
- ~~Phase 6 review (Medium): deactivation / subscription end leaves future orders~~ — done in Phase 6 fix (`OrderCancellationService`).
- Phase 6 review (Low): `confirmAllergy` ~~refused in apply-to-all~~ (done); staff PAST_DAY limit ~~D23~~; staff-cancelled re-open ~~D24~~; switch price ~~D25~~; late auto-assign cutoff ~~L7~~ (all done in Phase 6). **Open:** `confirmAllergy` is one flag per day request (only matters with `allergy_rule = warn_confirm`, not the default `block`); audit-log IP retention — **needs a decision** (retention period); removal impact page count is re-checked server-side (`confirmedCount`) — done.
- Phase 7 review (Low): ~~labels PDF yields + capped renders~~ (Phase 8/9, D27); ~~hard stop at MAX_EXPORT_ROWS~~, ~~xlsx writer stops after a client disconnect~~, ~~translated "export failed"~~, ~~cleanText strips U+061C / U+200B–D / U+FEFF~~, ~~NaN-safe label_grid~~ (`clampGrid`) — done in Phase 9. **Open:** export pages are separate queries, not one snapshot (an order changed during the export may appear twice or be missed; re-export) — accepted; xlsx shows the literal `'` prefix of escaped cells (cosmetic, safe).
- ~~Phase 8 review (Medium): `pdfRenderGate` has no per-user share~~ — done in Phase 9 (D27: `pdfUserRenderGate` 1 running + 1 waiting per user → 429 + Retry-After; renders of disconnected clients skipped).
- Phase 8 review (Low): ~~`inertia_middleware` unread count try/catch~~, ~~statements xlsx emails (D28)~~, ~~open-redirect guard `/\`~~ (`isLocalPath`), ~~download limiter before building the statement~~ — done in Phase 9. ~~`monthly_fee` uses the current subscription status (D29)~~ — obsolete with D31 (billing settings removed); statements "today" uses APP_TIMEZONE (same as the school's, one school) — accepted; admin statements overview recomputes the school per visit — accepted (a few SQL sums, < 50 ms on the demo data; cache only if a school grows past ~2,000 children).
- Phase 8 QA note: statements pages fall back to the current month on a malformed `?month=` (PDF/export 404) — intentional.

### Phase 9 QA + final security review
- ~~QA: ImportStore cap could drop the newest previews on same-millisecond ties~~ — done (in-process sequence tie-break; inherited by the holiday store).
- ~~QA: no test for the export hard stop~~ — done (`tests/unit/export_row_cap.spec.ts`).
- ~~Security H1: multipart auto-processing on every route left temp files (pre-auth disk exhaustion)~~ — done (autoProcess limited to the 2 import routes, 2 MB, `tmp/uploads`, `UploadCleanupMiddleware` deletes on every path; tests for anonymous `/login`, non-upload routes, import failures).
- ~~Security M1: cookie sessions never expire server-side~~ — done (2 h idle / 12 h absolute, remember-me restarts a fresh session).
- ~~Security M2: SMTP without requireTLS~~ — done (`requireTLS` in production unless `SMTP_SECURE` or loopback; `SMTP_SECURE` env).
- ~~Security L1: static headers missing on 404 / early errors~~ — done (server-level middleware + nginx `always` lines documented).
- ~~Security L2: pg error `detail` in logs~~ — done (stripped in `report`, redacted in the logger).
- ~~Security L3: unencrypted off-site backups~~ — done (docs: age/gpg/rclone crypt).
- ~~Security L4: FK migration fails with a bare violation~~ — done (pre-check lists the mismatched children).
- Security (residual, **open**): Apache `LimitRequestBody` on cPanel may only be settable domain-wide (documented scoping with `<If>`; the app refuses large bodies itself); login POST rate limiting at the proxy depends on the host (`mod_evasive`/Imunify) — the app's own limiters always apply.
- Final review (Low, post-launch): empty `tmp/uploads` at boot (files left only if the process is killed mid-upload); wrap the expired-session redirect in `isLocalPath()`; fixed maximum lifetime per remember-me chain; decide audit-log IP retention (Moroccan law 09-08).
- D31 review (Low): in-app notifications created before D31 for a subscription switch can still show "price lowered" (notification_center_service.ts:308 — show it only for supplements); migration 1794000000000 would abort if a supplement had price 0 (add a clear pre-check before running on real data).
