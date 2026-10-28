# Stack notes — AdonisJS 7

Checked on **2026-10-27** against docs.adonisjs.com, the official `adonisjs/vue-starter-kit` repo (branch `7.x`) and the npm registry (`/latest` dist-tag + `peerDependencies`).
Status legend: **[verified]** = read in official docs or npm metadata · **[unverified]** = not confirmed, Phase 1 must check it before relying on it.

Later phases: add anything surprising to the "Surprises log" at the bottom.

---

## 0. Platform

| Item | Value | Status |
|---|---|---|
| Node.js | **>= 24** (v7 upgrade guide: "AdonisJS v7 requires Node.js 24 or above"; `@adonisjs/lucid`, `@adonisjs/queue`, `@tuyau/core`, `@poppinss/ts-exec` declare `engines.node >=24`) | verified |
| npm | >= 11 (installation page) | verified |
| TypeScript | 5.9 or 6.0; JIT is `@poppinss/ts-exec` (replaces ts-node) | verified |
| Vite | `@adonisjs/vite@6` peers `vite ^8` | verified |

> **Deployment risk (cPanel):** cPanel/CloudLinux "Node.js Selector" only offers the `alt-nodejs` versions the host installed. I could not confirm that any host offers Node 24 (search found nothing for `alt-nodejs24`). **Check this with the hosting provider before Phase 9.** If Node 24 is not available, deploy to a small VPS / Docker host (the `docker-compose.yml` from Phase 1 helps) — AdonisJS 7 cannot run on Node 22.

## 1. Project creation (Inertia + Vue 3 + TypeScript)

```bash
npm create adonisjs@latest bfk-school-meals -- --kit=vue --pkg=npm
node ace serve --hmr        # dev server
```
Documented flags: `--kit`, `--pkg`, `--git-init`, `--skip-migrations`, `--token`, `--verbose`. **No `--db` / `--ssr` flag is documented.** [verified]

What the Vue starter kit (`adonisjs/vue-starter-kit@7.x`) contains [verified by reading the repo]:
- session auth (`@adonisjs/auth` 10, `@adonisjs/session` 8), Shield, CORS, static, Lucid, Inertia, Vite, VineJS 4, Tuyau, `vue-sonner` toasts;
- `app/controllers/session_controller.ts` **and `new_account_controller.ts` + `inertia/pages/auth/signup.vue`** — **delete signup**: parents cannot self-register (brief §3);
- Lucid configured for **SQLite (`better-sqlite3`)** → switch to PostgreSQL (§2) and remove `better-sqlite3`;
- **no Tailwind** — plain CSS in `inertia/css/app.css`. Add Tailwind v4 via its Vite plugin: `npm i -D tailwindcss@4 @tailwindcss/vite@4` (both 4.3.3), add `tailwindcss()` to `vite.config.ts`, replace `app.css` with `@import "tailwindcss";` [versions verified; wiring is the standard Tailwind v4 setup];
- `.env.example` has `TZ=UTC` → set `TZ=Africa/Casablanca`;
- no SSR by default (keep it off).

**Version drift — checked in Phase 1: none.** `npm create adonisjs@latest app -- --kit=vue --pkg=npm --git-init=false` (2026-10-27) installed `@adonisjs/core 7.6.0`, `@adonisjs/inertia 5.0.5`, `@inertiajs/vue3 3.9.1`, `@adonisjs/vite 6.0.4`, `vite 8.3.5`, `@tuyau/core 1.3.0`, TypeScript 6.0. Original note: the kit's `package.json` on GitHub still lists `@adonisjs/inertia ^4.0.0-next`, `@inertiajs/vue3 ^2.3`, `@adonisjs/vite ^5.1.0-next`, `vite ^7`. Current releases are `@adonisjs/inertia 5.0.5` (peers `@inertiajs/vue3 ^3.4`, `@adonisjs/vite ^6`), `@adonisjs/vite 6.0.4` (peers `vite ^8`, `@adonisjs/core ^7.5`). `create-adonisjs` may install either set. Phase 1: run `npm ls @adonisjs/inertia @inertiajs/vue3 vite` and, if old, upgrade them together; the v6→v7 guide says v7 targets **Inertia 3** (client breaking changes: renamed router events, no bundled Axios).

### Differences from v6 that matter here (v6→v7 upgrade guide) [verified]
- `Request`/`Response` classes renamed `HttpRequest`/`HttpResponse`.
- URL building: `router.makeUrl`/`makeSignedUrl` deprecated → `urlFor` from `@adonisjs/core/services/url_builder` (also in Edge templates — matters for email links).
- Bouncer no longer reads `app/policies/main.ts`; policies are indexed by the `indexPolicies()` hook into `.adonisjs/server/policies.ts`, imported via `#generated/policies`.
- Inertia: `sharedData` config removed → shared props go through an Inertia **middleware** (`app/middleware/inertia_middleware.ts`); flash messages are in a dedicated `flash` field (`usePage().flash`); `entrypoint` moved to `inertia/app.ts`; `history.encrypt` → top-level `encryptHistory`; `inertia.render` is type-checked against page props.
- Validation errors: flash key `errors` removed → `inputErrorsBag`.
- `config/encryption.ts` replaces `appKey` in `config/app.ts` (`APP_KEY` still used).
- Transformers (`#transformers/*`) + Tuyau type registry (`generateRegistry()`) for typed props/routes.
- Removed helpers `cuid`, `getDirname`, … → use `crypto.randomUUID()`, `import.meta.dirname`.
- `request.all()` now includes multipart files — never spread `request.all()` into models.

## 2. Lucid + PostgreSQL

| Package | Version | Install |
|---|---|---|
| `@adonisjs/lucid` | 22.4.2 (peers core ^7, luxon ^3.4.4, vine ^3\|^4) | `node ace add @adonisjs/lucid --db=postgres` (installs `pg` 8.23.1 + luxon) [verified] |

- Migrations / seeders / factories: same command family as v6 (`node ace make:migration`, `migration:run`, `db:seed`, `make:factory`). [verified for migrations; factories API assumed unchanged — unverified]
- **New in v7: generated schema classes.** After `migration:run`/`rollback` (not in production) Lucid writes `database/schema.ts`; models `extend` the generated `XxxSchema` class (see the kit's `app/models/user.ts`). `node ace schema:generate` regenerates; per-column/type overrides go in `database/schema_rules.ts` (rules can target a DB type, a column name or a table; "a rule replaces the defaults for the matched column, so you must list every decorator you want"). [verified]
  - **[verified Phase 1]** defaults: `date` → `DateTime` + `@column.date` (wrong for us), `jsonb`/`json` → `any`, `numeric` → `string`, pg arrays (`smallint[]`, `text[]`) report type `ARRAY` → `any`, `timestamptz` → `DateTime` (`created_at`/`updated_at` get autoCreate/autoUpdate). Rule lookup order: table column → table type → global column → primary key → global type. A rule replaces the defaults, so list the decorators. Nullability (`| null`) is added automatically.
  - **Final rules (`database/schema_rules.ts`)**: global `types.date` → `string` + `@column`; per-table `columns` for arrays and jsonb, e.g. `schools.school_days: number[]`, `schools.settings: StoredSchoolSettings` (imported with `imports: [{ source: '#types/school_settings', typeImports: ['StoredSchoolSettings'] }]`), `users.role: Role`, `users.locale: AppLocale`, `users.notification_prefs: Record<string, boolean>`. **Every later `text[]`/`jsonb`/enum-like column needs its own rule** (e.g. `children.allergies: AllergenCode[]`).
  - `database/schema.ts` is regenerated by `migration:run`/`rollback` (dev and test — the test runner's migrate/rollback did not change it in practice because it regenerates identical content after `migration:run`). It is ignored by ESLint/Prettier.
- **`date` columns as strings [verified Phase 1]:** `pg.types.setTypeParser(1082, (v) => v)` in `providers/time_provider.ts` `register()` (registered right after the core app provider, before Lucid boots). The same provider sets `process.env.TZ` and Luxon `Settings.defaultZone` to `Africa/Casablanca` and binds the `Clock` singleton. Covered by `tests/functional/date_columns.spec.ts`. Writing a `date`: pass the `'YYYY-MM-DD'` string. `@types/pg` is needed for typecheck.
- jsonb writes: pass a plain object (pg JSON-encodes objects). **Do not pass a JS array to a jsonb column** — pg converts arrays to PostgreSQL array literals; `JSON.stringify` it first.
- **IDs: use `increments` (int4), not `bigIncrements`.** pg returns `int8` as a **string** by default, which breaks `===` comparisons in policies. Exception: `order_audit_logs.id` can be int8 if needed later.
- **Soft deletes:** Lucid has no built-in soft delete (docs only show hand-written `beforeFind`/`beforeFetch` hooks). The community package `adonis-lucid-soft-deletes@2.1.0` peers `@adonisjs/core ^6` / `@adonisjs/lucid ^21` → **not v7-compatible**. Use a hand-written `deleted_at` column + explicit query scopes (see ERD §meals).
- Extensions: the ERD uses `btree_gist` (subscription non-overlap) — needs `CREATE EXTENSION` rights; fallback in the ERD.

## 3. Auth, Bouncer, limiter, Shield, session

| Package | Version | Notes |
|---|---|---|
| `@adonisjs/auth` | 10.1.0 | session guard + `withAuthFinder(hash)` mixin already in the kit. Remember-me: `useRememberMeTokens: true`, `rememberMeTokensAge`, `static rememberMeTokens = DbRememberMeTokensProvider.forModel(User)` and a hand-written `remember_me_tokens` migration (no generator). `auth.use('web').login(user, remember)`. **`User.verifyCredentials` throws a RuntimeException (500) when `password` is null** (invited users) → we use our own `LoginService.verifyCredentials` (lower-cased email lookup, dummy hash for unknown/no-password users, `E_INVALID_CREDENTIALS`, `InactiveAccountException`). [verified Phase 1] |
| `@adonisjs/session` | 8.3.0 | kit uses `SESSION_DRIVER=cookie`. Cookie sessions can't be revoked server-side → the auth middleware must **re-check `users.is_active` on every request** and log out inactive users (needed by Phase 2 "deactivating ends their sessions"). [verified kit; design decision] |
| `@adonisjs/bouncer` | 4.0.1 | `node ace add @adonisjs/bouncer`; policies indexed to `#generated/policies` by the `indexPolicies()` hook (`node ace codegen` refreshes it). Role abilities in `app/abilities/main.ts`; resource policies in `app/policies/*_policy.ts` (`SchoolPolicy` is the template: `before()` denies inactive users). `E_AUTHORIZATION_FAILURE` handles itself: GET → **plain-text** 403, form methods → flash + redirect back; our `app/exceptions/handler.ts` renders the Inertia page `errors/forbidden` with status 403 for GET/HEAD instead. [verified Phase 1] |
| `@adonisjs/limiter` | 3.0.1 | `node ace add @adonisjs/limiter --store=database` (non-interactive; creates `config/limiter.ts`, `start/limiter.ts`, the `rate_limits` migration and `LIMITER_STORE`). Stores: `redis`, `database` (PostgreSQL supported, creates a `rate_limits` migration), `memory`. **Use `database` in prod/dev (no Redis on cPanel), `memory` in tests** (`LIMITER_STORE=memory` in `.env.test`, `limiter.clear(['memory'])` in `group.each.setup`). **`penalize()` is not atomic** (it reads the counter, runs the callback, then increments): parallel requests all see `remaining > 0` and each gets a password check. Login therefore calls `limiter.use(...).consume(key)` (atomic increment, throws `E_TOO_MANY_REQUESTS`) **before** `LoginService.verifyCredentials`, then `.delete(key)` on success. Three limiters in `start/limiter.ts` (`LOGIN_LIMITS`): per IP 30/min no block (spraying; IPv6 keyed on the /64 via `app/support/ip.ts`), per IP+email 5/min then 20-min block, per email 50/15 min no block (distributed guessing). IP+email and email keys are reset on a successful login; the IP key is not. **Lockout protection:** a successful login sets the encrypted `bfk_kd` "known device" cookie (httpOnly, sameSite lax, secure in prod, 180 days; `app/support/known_device.ts`) holding HMAC(APP_KEY, normalized email) for up to 5 accounts. A request whose cookie contains the submitted email's hash skips the per-email limiter only (per-IP and IP+email still apply), so an attacker who exhausts an account's per-email budget cannot lock out its owner on a browser they used before. The check needs no DB lookup, so it does not reveal whether an email exists. The first refusal in a window logs `login: per-email limit reached` with the masked email. Routes: `limiter.define('name', () => limiter.allowRequests(n).every('1 minute'))` + `.use(throttle)` (none defined yet). [verified Phase 1 fix] Note: limiter peers `@adonisjs/redis ^10` while redis latest is 11 — irrelevant as long as we don't use Redis. |
| `trustProxy` | core | `request.ip()` (and so every IP rate limit) honours `X-Forwarded-For` only from trusted peers. Default `proxyAddr.compile('loopback')`. `config/app.ts` sets it from **`TRUST_PROXY`** via `parseTrustProxy()` (`app/support/env_guards.ts`): unset → `loopback` (nginx or Apache/Passenger on the same host — the cPanel case), `false` → trust nothing (app exposed directly), else a proxy-addr list (`loopback, 10.0.0.0/8`). **Gotcha:** the server passes a *string* `trustProxy` straight to `proxyaddr.compile(str)`, which does not split on commas (a list crashed boot) → `parseTrustProxy` splits and returns `proxyaddr.compile(array)` (a function; `defineConfig` passes functions through). `proxy-addr` is a direct dependency for that. `true`/`*`, and any list that trusts a sample public address (1.1.1.1, 8.8.8.8, 2606:4700::1, …; e.g. `0.0.0.0/1, 128.0.0.0/1`), are refused at startup. Every hop in front of the app must be listed: a CDN or second proxy in front of the same-host proxy needs its ranges in `TRUST_PROXY`, otherwise all clients appear as that CDN's IPs. The same-host proxy must **append** to `X-Forwarded-For`, not pass the client's value through unchanged or overwrite it with something else — nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (Apache `mod_proxy` appends by default). If the proxy is on another host, list its address, otherwise every client shares the proxy's IP and the per-IP limiter (30/min) throttles everyone together. [verified Phase 1 fix] |
| `@adonisjs/shield` | 9.0.0 | in the kit; CSRF on (XSRF-TOKEN cookie; Inertia 3's built-in client sends `X-XSRF-TOKEN` — verified by a curl login). CSP enabled in production only (`'self'` + `@nonce` scripts, inline styles allowed for Vue `:style`), HSTS production only, X-Frame-Options DENY, nosniff. `Referrer-Policy`, `Permissions-Policy`, `COOP` come from `app/middleware/security_headers_middleware.ts`. Tests: `shieldApiClient()` + `.withCsrfToken()`. [verified Phase 1; CSP not exercised against a production build yet] |

## 4. Drive + sharp

| Package | Version | Notes |
|---|---|---|
| `@adonisjs/drive` | 4.0.0 | `node ace add @adonisjs/drive --services=fs,s3 --install` [verified]. fs disk: `location: app.makePath('storage')`, `visibility: 'public'`, `serveFiles: true`, `routeBasePath: '/uploads'`. S3: `credentials`, `region`, `bucket`, `visibility`, **`endpoint`** for S3-compatible providers (R2 needs `region: 'auto'`). `forcePathStyle` is **not documented** — needed by MinIO-style providers [unverified]. Uploads: `file.moveToDisk(key, disk)`; disk API `drive.use().put/delete/getUrl/getSignedUrl`. Tests: `drive.fake()` → `fakeDisk.assertExists(key)`, `drive.restore()`. |
| `@aws-sdk/client-s3` | 3.1157.0 | optional peer of Drive, only for the s3 service. |
| `sharp` | 0.35.5 | native (libvips) prebuilt binaries. Risk on cPanel/CloudLinux: install must happen on the server (or same OS/arch) so the right prebuilt binary is picked. If sharp can't load in prod, fall back to storing the original only and showing it scaled by CSS (feature flag). |

## 5. Mail

| Package | Version | Notes |
|---|---|---|
| `@adonisjs/mail` | 10.4.0 | `node ace add @adonisjs/mail --transports=smtp` [verified]. SMTP host/port/auth from env; Mailpit in dev (SMTP 1025, UI 8025). Class-based mails extend `BaseMail` (`prepare()`), templates are Edge views via `htmlView` / `textView`. `mail.send` = immediate; `mail.sendLater` = **in-memory queue by default (lost on restart)**; `mail.setMessenger(...)` lets you plug a persistent backend. Tests: `const { mails } = mail.fake()` → `mails.assertSent(MailClass, finder?)`, `assertNotSent`, `assertQueued`. [verified] |

**Phase 1 setup [verified]:** `node ace add @adonisjs/mail --transports=smtp`. Mailers: `smtp` (Mailpit in dev, host SMTP in prod; auth only when `SMTP_USERNAME` is set) and a custom `log` mailer (`app/mail/log_transport.ts`, wraps `JSONTransport` from `@adonisjs/mail/transports/json`) selected with `MAIL_MAILER=log` when no SMTP server is available. It logs only the subject and masked recipients (`s***@example.test`); the body (invitation/reset tokens) is omitted unless `MAIL_LOG_BODY=true`, which `config/mail.ts` ignores in production. `MAIL_MAILER=log` with `NODE_ENV=production` makes `start/env.ts` throw at startup. Tests use `mail.fake()`.

**Recommendation — DB outbox, no queue package (see §7):** notification mails go through an `outbound_emails` table (ERD). Invitation and password-reset mails are the exception: sent directly with `mail.send` right after commit (the raw token must never be stored), failures logged; bulk mails (menu published, reminders, cancellations) are inserted and drained by the `mail:dispatch` Ace command every minute, with a per-run cap to respect the SMTP host's hourly limit. A custom messenger via `mail.setMessenger` that writes to the outbox is possible but its interface is **unverified** — a plain `OutboxService.enqueue()` is enough.

## 6. i18n

| Package | Version | Notes |
|---|---|---|
| `@adonisjs/i18n` | 3.0.1 | `node ace add @adonisjs/i18n` [verified]. Files in `resources/lang/{fr,en}/*.json`; ICU message format (no nested data objects → flatten); `detect_user_locale_middleware` — override `getRequestLocale` to use `users.locale`, then a cookie, then `Accept-Language`; `i18nManager.locale('fr')` for commands/jobs/mails; VineJS messages from `resources/lang/<locale>/validator.json` (`shared` section) — outside HTTP pass `i18n.createMessagesProvider()`. `fallbackLocales` + `defaultLocale: 'fr'`. |

**No built-in way to share translations with Inertia** [verified: not in docs]. **Implemented (Phase 1):** `i18nManager.getTranslationsFor(locale)` returns flat keys `<file>.<path>` (e.g. `auth.login.title` from `resources/lang/fr/auth.json`). `app/support/client_translations.ts` merges the fallback locale (fr) under the current one, drops server-only namespaces (`validator.`, `emails.`) and the Inertia middleware shares `locale` + `messages` on every response (cached in production). Vue: `useI18n()` in `inertia/composables/use_i18n.ts` → `t(key, values)` with `intl-messageformat@^11` (same major as `@adonisjs/i18n` 3.0.1's dependency). Locale resolution (`detect_user_locale_middleware.ts`): `users.locale` → `bfk_locale` plain cookie → `Accept-Language` → `fr`. `POST /locale` switches it. If `messages` grows large, consider sharing per-namespace or `inertia.once()`.

## 7. Scheduler and queue — recommendation

Options checked:

| Option | Version / status | Verdict |
|---|---|---|
| `@adonisjs/queue` (+ its built-in scheduler, `start/scheduler.ts`, `Job.schedule().cron().timezone()`) | 0.7.0 (2026-10-18), docs say **"currently experimental"**; needs Node 24, `@adonisjs/core ^7.6`, a **long-running worker** (`node ace queue:work`); schedules register when the HTTP server starts | Not for v1: experimental and needs a resident worker process. Revisit if we move to a VPS. |
| `adonisjs-scheduler` (community, KABBOUCHI) | 2.8.0, peers `@adonisjs/core ^6.2.0 \|\| ^7.0.0` (README still says "for AdonisJS v6"); `node ace scheduler:run` is a **long-running** process; has `.timezone()`, `.withoutOverlapping()` | Compatible, but needs a resident process — cPanel kills long-running processes. Good fallback on a VPS/Docker. |
| **Ace commands + cron** | built in | **Recommended.** |

**Recommendation: plain Ace commands, run by cron.** Reasons: works on cPanel (Cron Jobs UI), on a VPS and in Docker; no extra dependency; each command is testable as a service call.
Rules for every scheduled command:
1. Thin: it calls a service; the service uses `Clock` and does its own time comparisons in `Africa/Casablanca` (cron's own TZ doesn't matter — commands are "catch-up" style, e.g. publish every menu with `publish_at <= now`).
2. Idempotent: guarded by state columns (`published_at`, `reminder_sent_at`, `deadline_processed_at`) and/or `dedupe_key` unique constraints.
3. No overlap: take a PostgreSQL advisory lock (`SELECT pg_try_advisory_lock(<hash of command name>)`) and exit if not acquired.

Production crontab (documented in README, Phase 9):
```
*/5 * * * *  cd /app && node ace menus:publish-due
*/5 * * * *  cd /app && node ace menus:send-reminders
*/5 * * * *  cd /app && node ace menus:apply-deadline
*   * * * *  cd /app && node ace mail:dispatch
15  2 * * *  cd /app && node ace menus:close-past
30  2 * * *  cd /app && node ace holidays:generate --upcoming   # daily, no-op unless a new school year has no generated holidays
```
(`node ace` in production runs from the build folder: `cd build && node ace ...` — Phase 9 confirms.)
Dev: run commands by hand, or an npm script `scheduler:dev` that loops `node ace <cmd>` every minute. Optional later: `adonisjs-scheduler` if hosted somewhere that allows a resident process.

**Queue for emails:** none (see §5 outbox).

## 8. Validation

`@vinejs/vine` 4.4.0 (core peers `^4.0.0`). Only change from v3 that matters: `BaseModifiers` removed. [verified]

## 9. Tests (Japa)

| Package | Version |
|---|---|
| `@japa/runner` | 5.4.0 |
| `@japa/plugin-adonisjs` | 5.2.0 |
| `@japa/api-client` | 3.2.1 |
| `@japa/assert` | ^4 (kit) |
| `@japa/browser-client` | 2.3.0 (optional, Playwright) |

- DB isolation [verified]: `tests/bootstrap.ts` → `runnerHooks.setup: [() => testUtils.db().migrate()]`; per group `group.each.setup(() => testUtils.db().wrapInGlobalTransaction())` (faster) **or** `truncate()` — never both in a group. Use `truncate()` for tests that exercise real concurrency (the `max_quantity` race in Phase 6 needs two connections, which a global transaction can't model).
- Separate DB via `DB_DATABASE` in `.env.test`.
- Fake mailer: `mail.fake()` / `mail.restore()`; fake disk: `drive.fake()` / `drive.restore()`; limiter: memory store + `limiter.clear(['memory'])`. [verified]
- Time [verified Phase 1]: `Clock` is a container singleton; `freezeClock('2026-11-02T08:59')` (tests/helpers/clock.ts) calls `app.container.swap(Clock, () => frozen)`, `restoreClock()` calls `app.container.restore(Clock)`. Works for classes resolved later with `@inject()` / `app.container.make()` — **never `new Clock()` in app code**. `FrozenClock.travel({ minutes: 2 })` / `.set(...)`.
- Plugins in `tests/bootstrap.ts`: `apiClient()`, `sessionApiClient(app)`, `shieldApiClient()`, `authApiClient(app)` (`.loginAs(user)`), `inertiaApiClient(app)` (`.withInertia()`, `response.inertiaProps`, `assertInertiaComponent`). `@japa/api-client` must be a direct devDependency.
- **Validation errors:** v7 flashes field errors in `inputErrorsBag`; the session plugin's `assertValidationErrors()`/`assertHasValidationError()` still read the old `errors` key → use `response.flashMessage('inputErrorsBag')`.
- `.redirects(0)` to assert a redirect (`response.header('location')`).
- Test globs use brace syntax: `**/*.spec.{ts,js}`.

## 10. Libraries for later phases

| Need | Package | Version | Notes |
|---|---|---|---|
| CSV import | `csv-parse` | 7.0.3 (2026-09) | pure JS, stream/sync API. Strip BOM (`bom: true`) — Excel-saved CSVs. |
| CSV export | `csv-stringify` | 6.9.0 | same family. Escape formula injection (`= + - @`, also tab/CR) ourselves. |
| ICS parsing | `node-ical` | 0.27.3 | pure JS, Node >=22, deps `rrule-temporal` + `temporal-polyfill`. **Do not use its `fromURL`** — fetch the URL ourselves with the SSRF guard (https only, DNS check for private/loopback, redirect re-check, timeout, size cap), then call its parse function. Alternative: `ical.js` 2.2.1 (Mozilla). |
| Excel export | `exceljs` | 4.4.0 | pure JS, **last release 2023-10-19** (unmaintained but stable, widely used). Fallback: CSV only, or `write-excel-file`. |
| PDF | **`pdfkit`** | 0.20.2 (2026-08) | **Recommended**: pure JS, no Chrome, exact positioning for the A4 label grid; also fine for statements. Recent versions have a table API [unverified — if absent, draw tables manually]. Alternative: `pdfmake` 0.3.13 (declarative tables, built on pdfkit). Embed a TTF font (e.g. Noto Sans) for accents and future Arabic. |
| Images | `sharp` | 0.35.5 | see §4. |
| Dates | `luxon` | 3.7.2 | `Settings.defaultZone = 'Africa/Casablanca'` at boot; never fixed offsets. |
| Not compatible | `adonis-lucid-soft-deletes` 2.1.0 (v6 only), `@rlanz/bull-queue` 3.1.0 (peers core ^6.5, also needs Redis) | | do not install |

## 11. Environment variables (planned)

`TZ, PORT, HOST, APP_URL, APP_KEY, NODE_ENV, LOG_LEVEL, SESSION_DRIVER, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE, TRUST_PROXY, LIMITER_STORE, DRIVE_DISK, (S3_*), MAIL_MAILER, MAIL_LOG_BODY, SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, MAIL_FROM_ADDRESS, MAIL_FROM_NAME, MAIL_MAX_PER_RUN`

Phase 1 status: everything up to `MAIL_FROM_NAME` exists in `start/env.ts` and `.env.example` (`TZ` is validated to be exactly `Africa/Casablanca`; `MAIL_MAILER` is `smtp | log`, `log` refused in production; `TRUST_PROXY` and `MAIL_LOG_BODY` optional). `DRIVE_DISK`/`S3_*` (Phase 3) and `MAIL_MAX_PER_RUN` (Phase 5) are added by those phases.

## Surprises log

- 2026-10-27 (Phase 0): Vue starter kit ships SQLite, a signup page, no Tailwind, and possibly older Inertia/Vite majors than the current v7 packages — see §1.
- 2026-10-27 (Phase 1): **Morocco's offset rules changed in tzdata 2026c**: Africa/Casablanca was +01 (+00 during Ramadan) until 2026-09-20 01:00 UTC and is **+00 permanently** after that (Node 24.21 ICU tz 2026c and the system zoneinfo agree). Never hard-code `+01:00` — not even in tests; compare wall-clock strings or compute the offset with `IANAZone`. Old/unpatched Node builds or OS tzdata will compute different instants → keep Node and OS tzdata updated in production.
- 2026-10-27 (Phase 1): no Inertia/Vite version drift after all (§1). The kit's `inertia/css/app.css` is ~900 lines of custom CSS; replaced by Tailwind v4 (`@tailwindcss/vite` plugin, tokens in `@theme` in `inertia/css/app.css`). Font: `@fontsource-variable/plus-jakarta-sans` (self-hosted, family `'Plus Jakarta Sans Variable'`).
- 2026-10-27 (Phase 1): `withAuthFinder.verifyCredentials` 500s on a null password; Bouncer's 403 is plain text for GET; the session test plugin's validation assertions read a removed flash key — see §3 and §9.
- 2026-10-27 (Phase 1): `@adonisjs/eslint-config` has `@adonisjs/prefer-adonisjs-inertia-link`: import `Link` from `@adonisjs/inertia/vue` (accepts `href` or a typed `route`). Its typings reject `aria-*` attributes as props → pass them with `v-bind="{ 'aria-disabled': 'true' }"`.
- 2026-10-27 (Phase 1): `response.plainCookie()` base64/JSON-encodes by default; read it with `request.plainCookie(name)` (default decoding) so the test client's `withPlainCookie()` matches.
- 2026-10-27 (Phase 1): on the dev machine Docker is not installed and ports 3333/3334 are used by another project: the local `.env` uses a user-owned PostgreSQL 16 on 127.0.0.1:5433 and `PORT=3350`. `node ace serve` silently picks a random port when `PORT` is busy.
- 2026-10-28 (Phase 2): **`eslint --fix` turns `\uFEFF` escapes into literal BOM characters**, which then fail `no-irregular-whitespace` → write `String.fromCodePoint(0xfeff)`.
- 2026-10-28 (Phase 2): VineJS `.confirmed()` reports its error on **`password_confirmation`**, not on `password`. Custom rules (`vine.createRule`) report with `field.report(defaultMessage, ruleName, field)`; the i18n messages provider then resolves `validator.shared.messages.<ruleName>` (there is no `field.messages`). Field-specific overrides use flat keys like `"email.database.unique"`.
- 2026-10-28 (Phase 2): a model created with `Model.create()` does not read back DB defaults: unset columns are `undefined`, not `null` (e.g. `schoolId`, `credentialsVersion`) → policies test `typeof x === 'number'`, and factories/services set `credentialsVersion: 0` explicitly.
- 2026-10-28 (Phase 2): `mail.sendLater(mailInstance)` renders the mail, then pushes it to an in-memory fastq queue (no SMTP wait); the fake mailer records it under `mails.queued()`. Queue failures are emitted as `queued:mail:error` (logged in `start/events.ts`). **Superseded for password resets (Phase 2 fix M1):** `sendLater` still renders the Edge views and the controller still did the DB work on the request path, so timing differed for known emails. Now the controller only validates and consumes the limiters, then hands `(email, ip)` to `DeferredTasks.run()` (`app/services/deferred_tasks.ts`, container singleton, `setImmediate`, errors logged, drained on provider shutdown) and redirects; the lookup, token and `mail.send` run after the response. Tests await it with `(await app.container.make(DeferredTasks)).drain()`.
- 2026-10-28 (Phase 2): `mail.fake()` returns the fake mailer; its `mails` collection is on that object (`const { mails } = mail.fake()`), not on `mail.mails`.
- 2026-10-28 (Phase 2): Japa dataset titles interpolate a scalar value with `{$self}` (not `{0}`).
- 2026-10-28 (Phase 2): Bouncer's authorization failure on a form method (POST/PUT/DELETE) answers with flash + redirect back (302); only GET/HEAD get our 403 page.
- 2026-10-28 (Phase 2 fix M2): **nodemailer forced to `^10.2.1` with an npm `overrides` entry** (`@adonisjs/mail` 10.4.0 pins `nodemailer ^9.0.3`; the advisories cover `<= 10.1.3`, among them address-parser issues on quoted local parts). nodemailer 10's only declared breaking change is "Node.js >= 20" (it was rewritten in TypeScript with ESM + CJS builds). The deep imports used by `@adonisjs/mail` (`nodemailer/lib/<name>/index.js`, `nodemailer/lib/mailer/mail-message.js`) still resolve through the package's `./lib/*.js` export; the only runtime one is in the unused Postmark transport, the others are type-only. Verified: typecheck, full test suite, the log transport (JSONTransport) and one real SMTP delivery through `SMTPTransport` to a local sink (multipart text/html, UTF-8 subject encoded). `npm audit` no longer lists nodemailer (remaining: 2 low, `deepmerge` via `@adonisjs/lucid`). **Remove the override once `@adonisjs/mail` depends on nodemailer >= 10.2.1**, and re-check it on every `@adonisjs/mail` upgrade.
- 2026-10-28 (Phase 2 fix L1): `UserTokenService.issue()` locks the user row (`FOR UPDATE`) before revoking/inserting, and `user_tokens_one_open_per_type` (partial UNIQUE on `(user_id, type) WHERE used_at IS NULL AND revoked_at IS NULL`) guarantees at most one open link per user and type.
