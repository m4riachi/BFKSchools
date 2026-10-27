---
name: bfk-foundation
description: "Phase 1 of BFK School Meals. Scaffolds the AdonisJS 7 + Inertia/Vue 3 app with Docker, auth, roles, Bouncer, base layouts, i18n and the Clock service. Use to implement Phase 1."
model: inherit
color: blue
---

You build Phase 1 of BFK School Meals. First read `docs/PROJECT_BRIEF.md` §2, §3 and §7, then `docs/ERD.md`, `docs/PLAN.md`, `docs/STACK_NOTES.md` and `docs/DECISIONS.md`.

## Scope
1. **Scaffold** the AdonisJS 7 app with the Inertia + Vue 3 starter (TypeScript strict, Tailwind), following `docs/STACK_NOTES.md`. The repo already contains `CLAUDE.md`, `docs/` and `.claude/`. If the installer refuses a non-empty folder, scaffold into a temporary folder and move the files in. Never overwrite those three.
2. **Docker**: `docker-compose.yml` with PostgreSQL (current major) and Mailpit, plus a separate test database. `.env.example` documents every variable.
3. **Time**:
   - `TZ=Africa/Casablanca` and the Luxon default zone set at boot.
   - Make the pg driver return `date` columns (OID 1082) as plain `YYYY-MM-DD` strings, so no time-zone shift can happen. Document it in `docs/STACK_NOTES.md`.
   - An injectable `Clock` service: `now()` returns a Luxon DateTime in Africa/Casablanca, `today()` returns an ISO date string. Add a test helper to freeze time and move it. All later code uses `Clock`.
   - Small helpers: MAD money formatting, ISO-date utilities (week start = Monday, `isSchoolDay`).
4. **Migrations + models**: `schools` (with `settings` jsonb and the defaults from the ERD) and `users` (role, locale, is_active, last_login_at). Seed one school, "Britech School", and one demo user per role.
5. **Auth**: session login/logout, remember me, rate-limited login. Inactive users cannot log in. After login, redirect by role: staff go to `/admin`, kitchen to `/kitchen`, parents to `/`. Add role middleware.
6. **Bouncer**: abilities for `admin`, `manager`, `kitchen` and `parent`, plus the policy folder structure that later phases extend.
7. **Layouts (Vue)**:
   - admin layout (sidebar, French by default);
   - kitchen layout;
   - parent layout (mobile-first, bottom navigation).
   
   Shared UI components: button, input, select, modal, confirm dialog, table with pagination, badge, toast/flash, empty state, page header. Keep them simple and consistent, since later phases reuse them.
8. **i18n**: FR + EN. The locale comes from the user (switcher in the parent layout), and translations are shared with Inertia. No hard-coded UI text.
9. **Shield**: CSRF on, secure cookies in production, sensible security headers.
10. Fill in the **Commands** section of `CLAUDE.md` with the real commands (dev, migrate, seed, test, typecheck, lint, build).

## Tests
- Login success and failure
- Inactive user is blocked
- Rate limit works
- Role redirects
- A parent gets 403 on `/admin` and `/kitchen`
- Freezing the Clock works
- `date` columns round-trip without a shift

Follow the subagent rules and report format in `CLAUDE.md`.
