---
name: bfk-holidays
description: "Phase 4 of BFK School Meals. School holidays on the American calendar — rule-based US federal holiday generator, optional Moroccan holidays, school-break ranges, ICS import and calendar UI. Use to implement Phase 4."
model: inherit
color: orange
---

You build Phase 4. First read `docs/PROJECT_BRIEF.md` §5.3 and §6, then `docs/ERD.md`, `docs/PLAN.md`, `docs/DECISIONS.md` (D6, D7) and the existing code.

## Scope
1. **Migration + model**: `holidays` as in the ERD, with a stable `rule_key` for generated rows (e.g. `us_thanksgiving_2026`) and a `group_id` for ranges.
2. **`UsHolidayCalculator`** — pure functions, no I/O:
   - helpers: nth weekday of a month, last weekday of a month, fixed dates;
   - the **observed rule**: a holiday on Saturday is observed on Friday, one on Sunday on Monday;
   - holidays: Labor Day (1st Mon Sep), Columbus / Indigenous Peoples' Day (2nd Mon Oct), Veterans Day (Nov 11), Thanksgiving (4th Thu Nov) + the Friday after, Christmas (Dec 25), New Year's Day (Jan 1), MLK Day (3rd Mon Jan), Presidents' Day (3rd Mon Feb), Memorial Day (last Mon May), Juneteenth (Jun 19).
3. **Generator service**:
   - for one school year (the school's start/end dates), keep only dates that are school days inside the year, then upsert by `rule_key`;
   - idempotent: a row the admin disabled or deleted is never re-created (tombstone);
   - a back-office button "Generate holidays for school year YYYY–YYYY";
   - a yearly Ace command. The scheduler itself is set up in Phase 5, so register the command now and document it.
4. **Moroccan fixed-date holidays** (only when the setting is on): keep the list in a config file. Verify it against an official or reliable current source with web search before writing it, and cite the source in a comment. Lunar holidays (Eids…) are added by hand.
5. **Ranges** (winter break, spring break…): create, edit and delete as one group, stored as one row per school day.
6. **ICS import**:
   - from a file upload, or from a URL (https only, timeout, size limit, private and loopback addresses blocked, redirects checked);
   - all-day events become date ranges;
   - a preview with checkboxes and duplicate detection, then import with source `import`.
7. **UI**: month calendar (color by source, with a legend) and a list view with filters; enable/disable; rename.
8. **Impact hook**: create `HolidayImpactService` with `countAffectedOrders(dates)` and `cancelAffectedOrders(dates)`. Orders don't exist yet, so return 0 / do nothing and mark the integration point clearly — `bfk-parent-ordering` completes it in Phase 6. The UI already asks for confirmation when the count is above 0.
9. **Read API for later phases**: `isHoliday(schoolId, date)` and `holidaysBetween(schoolId, from, to)`.

## Tests
Use a school year from 1 Sep to 30 Jun with school days Mon–Fri. These expected dates have been verified:

| Holiday | 2026–2027 | 2027–2028 |
|---|---|---|
| Labor Day | 2026-09-07 | 2027-09-06 |
| Columbus / Indigenous Peoples' Day | 2026-10-12 | 2027-10-11 |
| Veterans Day | 2026-11-11 | 2027-11-11 |
| Thanksgiving + Friday after | 2026-11-26, 2026-11-27 | 2027-11-25, 2027-11-26 |
| Christmas | 2026-12-25 | Sat 2027-12-25 → observed 2027-12-24 |
| New Year's Day | 2027-01-01 | Sat 2028-01-01 → observed 2027-12-31 |
| MLK Day | 2027-01-18 | 2028-01-17 |
| Presidents' Day | 2027-02-15 | 2028-02-21 |
| Memorial Day | 2027-05-31 | 2028-05-29 |
| Juneteenth | Sat 2027-06-19 → observed 2027-06-18 | 2028-06-19 |

Also test: idempotent re-run, a disabled holiday is not re-created, ranges skip weekends, parsing of an ICS fixture, the SSRF guard on URL import, authorization.

Follow the subagent rules and report format in `CLAUDE.md`.
