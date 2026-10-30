# Deployment

Two supported targets. Pick one before going live:

- **(a) A small VPS** (or any Linux host / container platform) with Node 24 + PM2 + nginx +
  PostgreSQL — the recommended path, nothing host-specific.
- **(b) A cPanel account with "Setup Node.js App"** (CloudLinux Node.js Selector + Passenger).
  Only possible if the host offers **Node 24** — AdonisJS 7 does not run on Node 22.
  **Decision D15 is still pending**: ask the host whether `alt-nodejs24` (or a Node 24 entry in
  the Node.js Selector) is available. If not, use (a).

Whatever the target, the app is one Node process (`build/bin/server.js`) plus six cron lines;
there is no queue worker and no Redis.

The common steps (build, environment, first admin, cron, storage, backups, checklist) are
described once below the two host-specific sections.

---

## (a) VPS: Node 24 + PM2 + nginx + PostgreSQL

Tested layout: Ubuntu 24.04 LTS, user `bfk`, app in `/home/bfk/app`.

### 1. System packages

```bash
# Node 24 (NodeSource; or nvm/fnm for the bfk user)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql nginx certbot python3-certbot-nginx tzdata
sudo npm install -g pm2
node -v    # v24.x
```

Keep **`tzdata` and Node up to date** (`unattended-upgrades` for tzdata, Node minor updates):
Morocco's offset rules changed in tzdata 2026c (Africa/Casablanca is +00 permanently since
2026-09-20, see `docs/STACK_NOTES.md`). A host with old tzdata/ICU computes publication times
and deadlines one hour off.

### 2. PostgreSQL

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE bfk LOGIN PASSWORD 'change-me';
CREATE DATABASE bfk OWNER bfk;
\connect bfk
CREATE EXTENSION IF NOT EXISTS btree_gist;
SQL
```

PostgreSQL 16+ (18 recommended). Listen on localhost only (the default). The app needs no
superuser at runtime; `btree_gist` is created once here.

### 3. Build and first start

On the server (or build in CI and copy `build/`):

```bash
cd /home/bfk/app
git pull                                   # or upload the source
npm ci
npm run build
cp /home/bfk/.env.production build/.env    # see "Environment" below
cd build
npm ci --omit=dev                          # installs sharp's native binary for this host
node ace migration:run --force
node ace db:seed                           # production: only creates British Academy School Marrakech
node ace users:create-staff --email=admin@your-domain --name="Admin Name" --role=admin
```

PM2 (`/home/bfk/app/ecosystem.config.cjs`):

```js
module.exports = {
  apps: [
    {
      name: 'bfk',
      cwd: '/home/bfk/app/build',
      script: 'bin/server.js',
      instances: 1,            // one process: PDF/photo gates and deferred tasks are per process
      exec_mode: 'fork',
      max_memory_restart: '600M',
      kill_timeout: 20000,     // lets deferred emails finish (drain timeout 15 s)
      env: { NODE_ENV: 'production' },
    },
  ],
}
```

```bash
pm2 start /home/bfk/app/ecosystem.config.cjs
pm2 save && pm2 startup systemd -u bfk --hp /home/bfk   # restart on boot (run the printed command)
pm2 logs bfk
```

Redeploy: `git pull && npm ci && npm run build && cp ~/.env.production build/.env &&
(cd build && npm ci --omit=dev && node ace migration:run --force) && pm2 reload bfk`.
`npm run build` recreates `build/` — keep anything persistent (photos, logs) **outside** it (see
"File storage").

### 4. nginx + TLS

`HOST=127.0.0.1`, `PORT=3333` in `.env`; nginx is the only public listener.
`TRUST_PROXY` stays empty (= loopback): the app trusts `X-Forwarded-For` only from nginx on the
same host, and nginx must **append** the client address.

```nginx
# /etc/nginx/conf.d/bfk-limits.conf (http context)
# Coarse per-IP throttle of sign-in and password-link posts, in front of the
# app's own limiters (which count in PostgreSQL): stops floods cheaply.
limit_req_zone $binary_remote_addr zone=bfk_auth:10m rate=10r/m;
```

```nginx
# /etc/nginx/sites-available/bfk
server {
    listen 80;
    server_name repas.example.ma;
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name repas.example.ma;
    # certificates written by: sudo certbot --nginx -d repas.example.ma

    # Request bodies: small everywhere, larger only for meal photo uploads
    # (the app caps that route at 49 MB: 6 photos x 8 MB; CSV/ICS imports at 1 MB).
    client_max_body_size 2m;
    client_body_timeout 30s;
    client_header_timeout 15s;
    send_timeout 60s;

    # Same values as the app sets; `always` keeps them on nginx's own error
    # pages (413, 502…) too.
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=15552000" always;

    location ~ ^/(login|password/forgot|password/reset/|invitation/) {
        limit_req zone=bfk_auth burst=10 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3333;
        include /etc/nginx/snippets/bfk-proxy.conf;
    }

    location ~ ^/admin/meals/\d+/photos$ {
        client_max_body_size 50m;
        client_body_timeout 120s;
        proxy_pass http://127.0.0.1:3333;
        include /etc/nginx/snippets/bfk-proxy.conf;
    }

    location / {
        proxy_pass http://127.0.0.1:3333;
        include /etc/nginx/snippets/bfk-proxy.conf;
    }
}
```

```nginx
# /etc/nginx/snippets/bfk-proxy.conf
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_read_timeout 120s;      # exports and PDFs (bounded, usually < 5 s)
proxy_buffering off;          # stream Excel/CSV exports
```

Why the upload limits live here too: the app's own limits count multipart bytes after nginx
has accepted them; capping the body size and the body timeout at the proxy keeps a slow or huge
upload from tying up the Node process. In the app, only the two import routes write files to
disk (`tmp/uploads`, 2 MB cap, deleted at the end of every request whatever the outcome); every
other route leaves a multipart body unparsed, and photos are buffered in memory, decoded at most
two at a time and rate-limited per user.

Behind a CDN (Cloudflare…) in front of nginx: add the CDN's published ranges to
`TRUST_PROXY` (e.g. `loopback, 173.245.48.0/20, …`); otherwise every visitor shares the CDN's
IP for the rate limits. Ranges wider than /12 (IPv4) or /28 (IPv6) are refused at startup.

HTTPS is mandatory in production: session and "known device" cookies are `Secure`, HSTS is on,
and email links use `APP_URL` (set it to the `https://` address).

### 5. Docker variant

`docker-compose.yml` in the repo only runs the development services (PostgreSQL + Mailpit).
To run the app itself in a container, use a `node:24-bookworm-slim` image: `npm ci && npm run
build`, then in `build/` `npm ci --omit=dev`, `ENV TZ=Africa/Casablanca HOST=0.0.0.0`, install
`tzdata` in the image, mount a volume for `storage/` (or use `DRIVE_DISK=s3`), run
`node bin/server.js`, and run the six cron commands from the host (`docker exec bfk node ace
mail:dispatch` …) or a sidecar with `supercronic`. Put nginx (or Traefik/Caddy) in front with
the limits above and set `TRUST_PROXY` to the proxy container's network (e.g. `172.16.0.0/12`).

---

## (b) cPanel: Node.js application (Passenger)

Requires **Node 24 in the Node.js Selector** (D15, pending). Check first: `ls /opt/alt/` over
SSH should list `alt-nodejs24`, or the "Setup Node.js App" version list shows 24.x.

### 1. Database

cPanel → **PostgreSQL Databases**: create the database and user, add the user to the database
with all privileges. Ask the host to run `CREATE EXTENSION btree_gist;` in it if your user
can't (needed by the subscriptions table; without it the migration fails — ERD §subscriptions
describes the fallback).

### 2. Upload and build

Build locally or in CI (same Node major), then upload the **content of `build/`** to e.g.
`/home/USER/bfk/build`, and put the production `.env` in that folder. Over SSH (cPanel
"Terminal"), load the Node 24 environment the selector prints, then:

```bash
source /home/USER/nodevenv/bfk/build/24/bin/activate   # path shown by "Setup Node.js App"
cd /home/USER/bfk/build
npm ci --omit=dev          # installs sharp for this server (glibc linux-x64)
node ace migration:run --force
node ace db:seed
node ace users:create-staff --email=admin@your-domain --name="Admin Name" --role=admin
```

If `sharp` fails to load (old glibc on CloudLinux 7), install it on the server with
`npm install --os=linux --cpu=x64 sharp` or move to (a): photo upload and the demo images need it.

### 3. "Setup Node.js App"

- Node.js version: **24.x** · Application mode: **Production**
- Application root: `bfk/build` · Application URL: your (sub)domain
- Application startup file: `bin/server.js`
- Environment variables: either the UI or the `.env` file in the root (the app reads `.env`;
  variables set in the UI win). `NODE_ENV=production`, `TZ=Africa/Casablanca`, and leave
  `TRUST_PROXY` empty (Passenger/Apache is on the same host = loopback).
- Click **Restart** after each deploy.

Passenger starts the app on demand and may stop it when idle; that's fine (sessions are
cookies, jobs run from cron).

Uploads: Apache's `LimitRequestBody` applies first. Keep it small for the whole domain
(e.g. 2 MB) and raise it **only for the photo upload path**, if the host lets you add an
`.htaccess` / include for the domain (`LimitRequestBody` is allowed in `<Location>` / `<If>`):

```apache
LimitRequestBody 2097152
<If "%{REQUEST_URI} =~ m#^/admin/meals/[0-9]+/photos$#">
    LimitRequestBody 52428800
</If>
```

If the host only offers a domain-wide value, ask for ≥ 50 MB (photo uploads fail with 413
otherwise): the app itself refuses large bodies everywhere else (multipart bodies are only
written to disk on the two import routes, capped at 2 MB, and deleted after each request). Ask
the host whether they rate-limit POST requests (`mod_evasive`, Imunify360 or ModSecurity rules)
on `/login`, `/password/forgot`, `/password/reset/*` and `/invitation/*`; the app's own limiters
apply anyway.

### 4. Scheduler on cPanel

cPanel → **Cron Jobs**, one line per command, **absolute paths, no variables**, using the
selector's Node binary:

```cron
*/5 * * * *  cd /home/USER/bfk/build && /opt/alt/alt-nodejs24/root/usr/bin/node ace menus:publish-due    >> /home/USER/bfk/logs/cron.log 2>&1
*/5 * * * *  cd /home/USER/bfk/build && /opt/alt/alt-nodejs24/root/usr/bin/node ace menus:send-reminders >> /home/USER/bfk/logs/cron.log 2>&1
*/5 * * * *  cd /home/USER/bfk/build && /opt/alt/alt-nodejs24/root/usr/bin/node ace menus:apply-deadline >> /home/USER/bfk/logs/cron.log 2>&1
* * * * *    cd /home/USER/bfk/build && /opt/alt/alt-nodejs24/root/usr/bin/node ace mail:dispatch        >> /home/USER/bfk/logs/cron.log 2>&1
15 2 * * *   cd /home/USER/bfk/build && /opt/alt/alt-nodejs24/root/usr/bin/node ace menus:close-past     >> /home/USER/bfk/logs/cron.log 2>&1
30 2 * * *   cd /home/USER/bfk/build && /opt/alt/alt-nodejs24/root/usr/bin/node ace holidays:generate    >> /home/USER/bfk/logs/cron.log 2>&1
```

Some hosts refuse "every minute" crons: then use `*/2` or `*/5` for `mail:dispatch` (emails
are delayed a little; nothing is lost) and lower `MAIL_MAX_PER_RUN` accordingly. Each run boots
the app (~1 s) and exits; overlapping runs skip themselves (advisory lock).

### 5. SMTP limit (D16, pending)

Shared hosts usually cap outgoing mail per hour (often 100–500) and may silently drop the
excess. Ask the host for the exact number and set `MAIL_MAX_PER_HOUR` a bit below it (failed
SMTP attempts count too). `MAIL_MAX_PER_RUN` × runs per hour should not exceed it by much.
Invitations and password resets are sent immediately (outside the outbox) and are rare.

---

## Environment (production)

Start from `.env.example` (every key is explained in the README). Production values:

```dotenv
NODE_ENV=production
TZ=Africa/Casablanca
HOST=127.0.0.1
PORT=3333
LOG_LEVEL=info
APP_KEY=<node ace generate:key --show>
APP_URL=https://repas.example.ma
TRUST_PROXY=
SESSION_DRIVER=cookie
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=bfk
DB_PASSWORD=<secret>
DB_DATABASE=bfk
LIMITER_STORE=database
MAIL_MAILER=smtp
MAIL_FROM_NAME=BFK School Meals
MAIL_FROM_ADDRESS=no-reply@repas.example.ma
SMTP_HOST=<host smtp>
SMTP_PORT=587
SMTP_SECURE=false        # true for port 465; otherwise STARTTLS is required in production
SMTP_USERNAME=<user>
SMTP_PASSWORD=<secret>
MAIL_MAX_PER_RUN=50
MAIL_MAX_PER_HOUR=<host limit minus a margin>
DRIVE_DISK=s3            # or fs with a persistent folder, see below
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
S3_REGION=…
S3_BUCKET=…
S3_ENDPOINT=             # https only, for non-AWS providers
```

The app refuses to start with `MAIL_MAILER=log`, a non-https `S3_ENDPOINT`, a `TZ` other
than `Africa/Casablanca`, `TRUST_PROXY=true` or a too-wide public range, or (with S3) a bucket
whose signed-URL origin differs from the one allowed by the CSP. `MAIL_LOG_BODY` is ignored.
Keep the `.env` file readable by the app user only (`chmod 600`).

## File storage (meal photos)

- **S3-compatible bucket (recommended)** — `DRIVE_DISK=s3`. Keep the bucket **private** (no
  public ACL, no public bucket policy); the app redirects logged-in users to 10-minute signed
  URLs and the CSP allows exactly the bucket's origin. No CORS rule is needed (images are
  plain `<img>` loads). After the first deploy, **upload one photo and open it in a browser**
  (catalog and parent portal): if it doesn't show, the browser console names the blocked
  origin — set `S3_PUBLIC_ORIGIN` to it. Enable bucket versioning or a lifecycle backup if
  the provider offers it.
- **Local disk** — `DRIVE_DISK=fs` writes to `storage/` next to `bin/server.js`, i.e.
  `build/storage`, which a rebuild deletes. Make it a symlink to a persistent folder:
  `mkdir -p /home/bfk/storage && ln -sfn /home/bfk/storage /home/bfk/app/build/storage` (redo
  after each build, or script it), and back that folder up. Files are never served directly
  (only through `/media/meal-photos/:id/:variant`, logged-in users).

`tmp/` (CSV/ICS import previews, ≤ 1 h) can be lost safely.

## PostgreSQL backups

Nightly dump, kept 30 days, plus a copy off the server:

```cron
0 3 * * *  pg_dump --format=custom --no-owner -h 127.0.0.1 -U bfk bfk > /home/bfk/backups/bfk-$(date +\%F).dump && find /home/bfk/backups -name 'bfk-*.dump' -mtime +30 -delete
```

(`~/.pgpass` with `127.0.0.1:5432:bfk:bfk:<password>`, mode 600; on cPanel use the
"Backup" feature or the same cron with the host's `pg_dump`.)

The dumps hold personal data (parents' contact details, **children's names, classes and
allergies**): **encrypt them before they leave the server**, e.g.
`age -r <public key> -o bfk-YYYY-MM-DD.dump.age bfk-YYYY-MM-DD.dump` (or `gpg --encrypt`, or an
`rclone crypt` remote) and keep the private key offline. Then copy them elsewhere (rclone to
another provider, the host's remote backups…). Same for photo backups. **Test a restore** once:
`createdb bfk_restore && pg_restore --no-owner -d bfk_restore bfk-YYYY-MM-DD.dump`.
With `DRIVE_DISK=fs`, back up the storage folder too (rsync); photos are referenced by the
database, so restore both from the same night.

## Sessions

Sessions live in an encrypted cookie (`SESSION_DRIVER=cookie`). The server ends a signed-in
session after **2 h without a request** or **12 h after sign-in** (timestamps stored in the
session, checked on every request), after a password change/reset, an email change or a
deactivation, and on logout. "Keep me signed in" (remember-me token in the database, deleted on
logout and on every password change) then starts a fresh session. Changing `APP_KEY` ends
every session at once.

## Logs

The app logs JSON to stdout (PM2: `~/.pm2/logs`, rotate with `pm2 install pm2-logrotate`;
Passenger: the app's `stderr.log`). Logs never contain passwords, tokens, cookies or full email
addresses (masked as `s***@domain`). Cron output goes to `logs/cron.log` (rotate it).

## Production checklist

- [ ] Node **24.x** (`node -v` in the app's environment *and* in the cron's Node path) — D15.
- [ ] `NODE_ENV=production`, `TZ=Africa/Casablanca`; OS `tzdata` and Node current (2026 Morocco rules).
- [ ] `APP_KEY` generated on the server, kept secret, backed up with the `.env` (changing it signs everyone out).
- [ ] `APP_URL` is the public **https** URL; HTTPS works and HTTP redirects to HTTPS.
- [ ] Reverse proxy appends `X-Forwarded-For`; `TRUST_PROXY` matches every proxy/CDN hop; body size and timeouts set; POST rate limit on the sign-in/password routes; security headers with `always`.
- [ ] `MAIL_MAILER=smtp`, SMTP credentials, TLS (`SMTP_SECURE=true` on 465, or STARTTLS on 587 — required in production), `MAIL_FROM_ADDRESS` on a domain with SPF/DKIM; `MAIL_MAX_PER_HOUR` = host limit (D16). Send yourself an invitation to check delivery and links.
- [ ] `LIMITER_STORE=database`, `SESSION_DRIVER=cookie`.
- [ ] `node ace migration:run --force` done; `node ace db:seed` created the school; first admin created with `users:create-staff`; school year and settings checked in `/admin/settings`.
- [ ] The six cron lines installed (Node 24 binary, absolute paths); `logs/cron.log` shows runs without errors.
- [ ] Photos: S3 bucket private and one photo displayed in the browser, or `storage/` on a persistent, backed-up folder.
- [ ] Nightly `pg_dump`, **encrypted** off-site copy, and one restore tested.
- [ ] `npm audit --omit=dev` reviewed (known: 2 low, `deepmerge` via `@adonisjs/lucid`, see STACK_NOTES).
- [ ] No demo data on the real site: `db:seed` skips the demo seeders in production; `bfk:seed demo` is for a test deployment only (`ALLOW_DEMO_SEED=true` + `BFK_DEMO_PASSWORD`) — remove `ALLOW_DEMO_SEED` afterwards. Never copy a development database.
- [ ] Meal catalog: `node ace bfk:seed catalog --email=…` loads the 13 trays and the BFK restaurant menu (181 inactive supplements, D32) with photos (+ one account) if you want to start from it.

## Railway (PaaS)

- Build `npm run build`, start from `build/` (`cd build && node bin/server.js`), Node 24. Run `node ace migration:run --force` as the pre-deploy command.
- Photos: Railway's filesystem is **reset on every deploy**. With `DRIVE_DISK=fs`, attach a Railway volume mounted on the app's `storage/` folder (`<app dir>/build/storage` when the server runs from `build/`), or use `DRIVE_DISK=s3` with a bucket. Otherwise the seeded/uploaded photos disappear at the next deploy (the meals stay, the pictures 404).
- Seed once from a shell on the service (`railway ssh`, then `cd build` if needed):
  - test deployment, everything: set `ALLOW_DEMO_SEED=true` and `BFK_DEMO_PASSWORD=<strong>` on the service, then `node ace bfk:seed demo`; remove `ALLOW_DEMO_SEED` afterwards.
  - meals + one account: `node ace bfk:seed catalog --email=you@bfk.ma --name="Your Name"` (password asked).
- Do not put seeding in the start or pre-deploy command: it would run on every deploy (harmless, it is idempotent, but slow).

