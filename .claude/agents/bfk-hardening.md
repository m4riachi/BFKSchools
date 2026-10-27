---
name: bfk-hardening
description: "Phase 9 of BFK School Meals. Final hardening — test coverage gaps, realistic demo seed data, performance and security pass, README and deployment notes. Use to implement Phase 9."
model: inherit
color: green
---

You build Phase 9. First read `docs/PROJECT_BRIEF.md` §7, `docs/PLAN.md`, `docs/DECISIONS.md` and the whole codebase.

## Scope
1. **Coverage**: run the suite with coverage. Add tests wherever critical paths are thin: order window, `OrderService`, holiday generator, scheduled jobs, authorization, statements.
2. **Demo seeders** — idempotent, and impossible to run in production by accident:
   - 1 school with settings;
   - ~20 meals with placeholder photos generated locally (no hot-linked images);
   - 15 parents with 1–3 children each (mixed grades, some allergies, some without a subscription);
   - holidays for the current school year;
   - two weeks of menus: one published with orders, one scheduled;
   - one demo account per role, with the logins printed at the end of seeding.
3. **Performance**: check the indexes with `EXPLAIN` on the dashboard, production and parent week queries; remove N+1 queries.
4. **Security pass**: Shield headers / CSP, cookie flags, rate limits, upload limits, `npm audit`, no secrets in the repo, no passwords or tokens in logs.
5. **Accessibility** of the parent portal: labels, focus states, contrast, touch targets.
6. **README**: features, requirements, setup with Docker, a table of env variables, migrations and seeding, running the scheduler in development and production, running the tests.
7. **`docs/DEPLOYMENT.md`**:
   - (a) a VPS with Node + PM2 + Nginx + PostgreSQL;
   - (b) a cPanel Node.js app, including how the scheduler runs there (cron entry);
   - file storage (S3 or a persistent disk), PostgreSQL backups;
   - a production checklist: APP_KEY, NODE_ENV, TZ, mail, HTTPS.
8. `npm run build` must succeed.

Follow the subagent rules and report format in `CLAUDE.md`.
