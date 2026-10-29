# BFK School Meals

Web app for **BFK Resto × Britech School**: parents choose their children's weekly school
lunches on their phone; BFK staff manage the meal catalog, school holidays, weekly menus,
kitchen production and monthly statements.

Stack: AdonisJS 7 (TypeScript, Node 24) · PostgreSQL · Lucid · Inertia + Vue 3 · Tailwind 4 ·
VineJS · Bouncer · Drive + sharp · Mail · i18n (FR/EN) · Luxon · Japa.

- Functional spec: [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md) · schema: [`docs/ERD.md`](docs/ERD.md) ·
  business decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md) · stack notes and surprises:
  [`docs/STACK_NOTES.md`](docs/STACK_NOTES.md) · deployment: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Features

| Area | What it does |
|---|---|
| Parent portal (`/`, mobile-first) | Week view per child: pick the main meal (included in the subscription, no price — D31) and supplements (priced, billed) per day, "no meal this day", "same choice for all my children"; allergy check (meals with a child's allergen are refused); every rule decided on the server (`OrderWindowService`). Order history, monthly statement + PDF, notification center with email preferences, **Account** tab (details, change password). FR/EN. |
| Back-office (`/admin`, admin + manager) | Dashboard (today/tomorrow, next week's selection rate, month-to-date billed supplements, upcoming holidays). Parents and children (allergies, subscriptions, invitations, CSV import). Meal catalog with photos (WebP thumbnails). Holidays (US federal generator, optional Moroccan holidays, breaks, ICS import). Weekly menu builder (copy previous week, templates, default dish, schedule/publish). Orders per day and per child (audited staff changes). Monthly statements (all families, Excel export, PDF). Settings (admin only). |
| Kitchen (`/kitchen`, admin + manager + kitchen, read-only) | Production sheet per day (by grade/class), allergy sheet, printable labels PDF, Excel/CSV exports. |
| Jobs (cron) | Automatic menu publication, deadline reminders, default meal at the deadline, outbox email dispatch, closing past weeks, yearly holiday generation. |

Roles: `admin`, `manager`, `kitchen`, `parent`. Parents cannot sign up: staff create them and
send an invitation link (or import a CSV).

## Requirements

- **Node.js 24** or later and npm 11 (AdonisJS 7 does not run on Node 22).
- **PostgreSQL 16+** with the `btree_gist` extension (subscription periods non-overlap
  constraint) and two databases: `bfk_dev` and `bfk_test`.
- `sharp` prebuilt binaries for your OS/CPU (installed by `npm install`; glibc or musl Linux,
  macOS, Windows x64/arm64).
- Optional: Docker (PostgreSQL + Mailpit for local email testing).

## Setup (development)

```bash
git clone <repo> bfk-school-meals && cd bfk-school-meals
npm install
cp .env.example .env
node ace generate:key           # fills APP_KEY in .env
```

Database and mail catcher, either:

- **Docker:** `docker compose up -d` — PostgreSQL 18 on port 5432 (user/password `bfk`/`bfk`,
  databases `bfk_dev` + `bfk_test`, `btree_gist` enabled) and Mailpit (SMTP 1025, web UI
  <http://localhost:8025>). Keep `MAIL_MAILER=smtp` to read the emails in Mailpit.
- **A local PostgreSQL:** create the two databases owned by your user and run
  `CREATE EXTENSION IF NOT EXISTS btree_gist;` in each, then set `DB_*` in `.env`. Without
  an SMTP server, set `MAIL_MAILER=log` (and `MAIL_LOG_BODY=true` to see invitation/reset links
  in the log).

Then:

```bash
node ace migration:run
node ace db:seed                # demo data (see below), safe to run again
npm run dev                     # http://localhost:3333 (PORT in .env; if busy, a random port — read the log)
```

Reset everything: `node ace migration:fresh --seed`.

> **After `node ace migration:rollback`** (development): Lucid regenerates `database/schema.ts`
> from the database, and once every table is rolled back the file is left empty — the models
> extend those schema classes, so the app (and `node ace` commands that load models) won't
> boot. Run `node ace migration:run` right after (it regenerates the file), or restore it with
> `git checkout database/schema.ts`.

### Demo data and accounts

`node ace db:seed` (development and test only — the demo seeders refuse to run with
`NODE_ENV=production`) creates, idempotently:

- Britech School with its current school year and default settings;
- 22 meals: 13 subscription trays (BFK's real lunches, free — D31 — with the real photos in
  `database/demo/meal_photos/`) and 9 priced supplements (placeholder photos generated locally
  with sharp); FR/EN names and descriptions, EU allergens (a conservative guess — to be confirmed
  by BFK). Every photo goes through the normal upload pipeline (WebP + thumbnail);
- 15 parents with 1–3 children each (mixed grades and classes, some allergies and dietary notes,
  some children without a subscription, one inactive child); most parents can sign in, two are
  only invited, one was never invited;
- the school year's US federal holidays plus a winter and a spring break;
- weekly menus from the start of the previous month: past weeks published, ordered, processed at
  the deadline and closed (so last month's statement is final); the current week published with
  orders and default meals assigned; next week built and **scheduled**.

Every demo account uses the password **`Demo1234!`** (printed at the end of the seed):

| Role | Email |
|---|---|
| admin | `admin@bfk.test` |
| manager | `manager@bfk.test` |
| kitchen | `kitchen@bfk.test` |
| parent | `parent@bfk.test` (two children), or e.g. `karima.alaoui@demo.bfk.test` (any `@demo.bfk.test` parent with access) |

Seeding never sends email (the school's email setting is switched off while it runs).
`migration:fresh` does not delete photo files: clear `storage/` by hand if you care.

## Environment variables

All keys are in [`.env.example`](.env.example) and validated at startup by `start/env.ts`.
Tests read `.env.test` on top of `.env` (memory session/limiter, `bfk_test`, log mailer).

| Variable | Example / default | Meaning |
|---|---|---|
| `TZ` | `Africa/Casablanca` | Business time zone. Must be exactly this IANA name (startup check). Never a fixed offset. |
| `PORT` | `3333` | HTTP port. |
| `HOST` | `localhost` | Bind address (`0.0.0.0` in a container, `127.0.0.1` behind a same-host proxy). |
| `NODE_ENV` | `development` | `development`, `production` or `test`. Production turns on CSP/HSTS, secure cookies, status pages, and refuses dev-only settings. |
| `LOG_LEVEL` | `info` | pino level (`debug`, `info`, `warn`, `error`). |
| `APP_KEY` | — | Secret for encryption, cookies and signed values (`node ace generate:key`). Changing it signs everybody out and invalidates "known device" cookies. Never commit it. |
| `APP_URL` | `http://localhost:3333` | Public base URL, used in email links. `https://…` in production. |
| `TRUST_PROXY` | empty | Which reverse proxies may set `X-Forwarded-For` (the client IP used by rate limits). Empty = `loopback` (nginx/Apache on the same host, cPanel). `false` = app exposed directly. Otherwise a comma list of IPs/CIDRs or `loopback`, `linklocal`, `uniquelocal`; public ranges must be at least /12 (IPv4) or /28 (IPv6) — e.g. a CDN's published ranges. `true`/`*` and wider public ranges are refused at startup. |
| `SESSION_DRIVER` | `cookie` | `cookie` (default, no server state), `database` or `memory` (tests). A signed-in session ends after 2 h without a request or 12 h after sign-in (checked on the server with timestamps stored in the session; constants in `app/support/login_session.ts`); "keep me signed in" then starts a fresh session. |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_DATABASE` | `127.0.0.1` `5432` `bfk` `bfk` `bfk_dev` | PostgreSQL connection. |
| `LIMITER_STORE` | `database` | Rate-limit counters: `database` (dev/prod, no Redis needed) or `memory` (tests). |
| `MAIL_MAILER` | `smtp` | `smtp`, or `log` (dev/test only — refused in production: writes subject + masked recipient to the log). |
| `MAIL_LOG_BODY` | `false` | With `log`: also log the text body (to read invitation/reset links in dev). Ignored in production. |
| `MAIL_FROM_NAME` `MAIL_FROM_ADDRESS` | `BFK School Meals`, `no-reply@bfk.local` | Sender of every email (use an address of a domain whose SPF/DKIM the SMTP server signs). |
| `SMTP_HOST` `SMTP_PORT` | `127.0.0.1` `1025` | SMTP server (Mailpit in dev). Connections time out after 10 s, idle sockets after 30 s. |
| `SMTP_USERNAME` `SMTP_PASSWORD` | empty | SMTP login (auth is used only when a username is set). |
| `SMTP_SECURE` | `false` | `true` = TLS from the first byte (port 465). Otherwise, in production, **STARTTLS is required** (ports 587/25) unless `SMTP_HOST` is a loopback relay — a stripped STARTTLS makes the send fail instead of leaking the SMTP password and invitation/reset links. |
| `MAIL_MAX_PER_RUN` | `50` | Outbox emails sent per `mail:dispatch` run (cron: every minute). |
| `MAIL_MAX_PER_HOUR` | `250` | Rolling-hour cap (sent emails + failed SMTP attempts). **Set it to the SMTP host's hourly limit** (decision D16 — still to confirm with the host). |
| `DRIVE_DISK` | `fs` | Meal photo storage: `fs` (local `storage/` folder, never served directly) or `s3`. |
| `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` | — | Bucket credentials (required when `DRIVE_DISK=s3`). |
| `S3_REGION` | `eu-west-3` | AWS region; `auto` for Cloudflare R2. |
| `S3_BUCKET` | — | Bucket name. Keep the bucket **private**: logged-in users get 10-minute signed URLs. |
| `S3_ENDPOINT` | empty | Non-AWS providers (R2, MinIO, Scaleway…). Must be `https://` in production. |
| `S3_FORCE_PATH_STYLE` | `false` | Path-style URLs (MinIO). |
| `S3_PUBLIC_ORIGIN` | empty | Only if your provider signs URLs on another host: that https origin (no path), allowed in the CSP `img-src`. At boot (production + s3) the app presigns a dummy key and refuses to start if the signed URL's origin is not the one the CSP allows. |

## Tests

```bash
npm test                                         # whole suite (~4 min), uses bfk_test
node ace test unit                               # one suite
node ace test --files=tests/functional/auth.spec.ts
npm run typecheck && npm run lint
```

The test runner migrates `bfk_test` itself, fakes the mailer and the Drive disk, and freezes
time with `freezeClock()` (`tests/helpers/clock.ts`). `tests/functional/hardening/week_cycle.spec.ts`
walks a whole week: build → automatic publication → parent orders → deadline auto-assign →
kitchen sheet → statement.

## Scheduler (jobs)

Jobs are plain Ace commands run by **cron** (no resident worker). Each one is idempotent,
catch-up style (a missed run is made up by the next one) and protected by a PostgreSQL advisory
lock (an overlapping run exits immediately). Cron's own time zone doesn't matter: the jobs
compare instants in Africa/Casablanca.

| Command | When | Does |
|---|---|---|
| `menus:publish-due` | every 5 min | Publishes scheduled menus whose `publish_at` passed (notification + email to parents) |
| `menus:send-reminders` | every 5 min | Reminder before the order deadline to parents with a missing day |
| `menus:apply-deadline` | every 5 min | At the deadline, default meal for subscribed children without a choice |
| `mail:dispatch` | every minute | Sends the outbox emails within `MAIL_MAX_PER_RUN` / `MAIL_MAX_PER_HOUR`, retries failures |
| `menus:close-past` | daily 02:15 | Closes finished weeks |
| `holidays:generate` | daily 02:30 | Generates the holidays of each school's year (creates rows after a new year is set) |

**Development:** run one by hand (`node ace menus:publish-due`) or all of them every minute with
`npm run scheduler:dev` (Ctrl+C to stop; refused in production).

**Production crontab** (as the app user; paths are absolute — cPanel's Cron Jobs screen accepts
no variables, write each line in full). `node ace` runs from the **build folder**, which must
contain the production `.env`:

```cron
# BFK School Meals — scheduled jobs
SHELL=/bin/sh
*/5 * * * *  cd /home/bfk/app/build && /usr/bin/node ace menus:publish-due     >> /home/bfk/app/logs/cron.log 2>&1
*/5 * * * *  cd /home/bfk/app/build && /usr/bin/node ace menus:send-reminders  >> /home/bfk/app/logs/cron.log 2>&1
*/5 * * * *  cd /home/bfk/app/build && /usr/bin/node ace menus:apply-deadline  >> /home/bfk/app/logs/cron.log 2>&1
*   * * * *  cd /home/bfk/app/build && /usr/bin/node ace mail:dispatch         >> /home/bfk/app/logs/cron.log 2>&1
15  2 * * *  cd /home/bfk/app/build && /usr/bin/node ace menus:close-past      >> /home/bfk/app/logs/cron.log 2>&1
30  2 * * *  cd /home/bfk/app/build && /usr/bin/node ace holidays:generate     >> /home/bfk/app/logs/cron.log 2>&1
```

Replace `/usr/bin/node` with your Node 24 binary (`which node`; on cPanel/CloudLinux e.g.
`/opt/alt/alt-nodejs24/root/usr/bin/node`) and `/home/bfk/app` with the app folder. Rotate
`cron.log` (logrotate) or send it to `/dev/null` once things work.

## Production build and run

```bash
npm ci
npm run build                     # → build/ (server JS, compiled assets, lang files, fonts)
cp .env.production build/.env     # your production env (NODE_ENV=production …)
cd build
npm ci --omit=dev
node ace migration:run --force
node ace db:seed                  # production: only creates Britech School (demo seeders are skipped)
node ace users:create-staff --email=you@example.com --name="Your Name" --role=admin
node bin/server.js                # behind nginx/Apache, under PM2/systemd/Passenger
```

`users:create-staff` is how the first admin is created — demo seeders never run in production.
Prefer the **interactive prompt** (the password is typed hidden and never lands in the shell
history). `BFK_NEW_PASSWORD` exists for scripted setups only: if you use it, set it for that one
command and remove it right after (`unset BFK_NEW_PASSWORD`, and clear it from the shell history
or the CI variables). Admins then create parents and
invite them from the back-office.

Deployment guides (VPS with Node + PM2 + nginx + PostgreSQL, cPanel Node.js app, file storage,
backups and the production checklist): **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**.

## Project layout

```
app/controllers   thin HTTP controllers (admin/, kitchen/, parent/, auth/)
app/services      business logic (OrderWindowService = every ordering rule)
app/policies      Bouncer policies (a parent only reaches their own family)
app/support       small framework-free helpers (dates, money, render gates…)
commands/         Ace commands run by cron (+ scheduler:dev, users:create-staff)
database/         migrations, seeders (demo data), factories
inertia/          Vue pages, layouts, components
resources/lang    fr/ and en/ translations (every UI string and email)
tests/            Japa unit + functional tests
```
