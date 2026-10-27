---
name: bfk-kitchen-dashboard
description: "Phase 7 of BFK School Meals. Back-office dashboard KPIs, kitchen production sheets, allergy sheet, printable labels PDF and Excel/CSV exports. Use to implement Phase 7."
model: inherit
color: pink
---

You build Phase 7. First read `docs/PROJECT_BRIEF.md` §5.7 and §5.8, then `docs/ERD.md`, `docs/PLAN.md`, `docs/STACK_NOTES.md`, `docs/DECISIONS.md` and the existing code.

## Scope
1. **`ProductionReportService`** — SQL aggregations, no N+1, active orders only:
   - quantity per meal per day, with a breakdown by grade and class;
   - supplement totals;
   - children without an order;
   - amounts per period, split subscription / supplement.
2. **Dashboard** (`/admin`):
   - today and tomorrow: dishes, supplements, children without a choice;
   - next week: menu status, % of children with a selection, countdown to the deadline;
   - upcoming holidays (next 30 days);
   - month-to-date amounts.
3. **Kitchen area** (`/kitchen`, read-only for the kitchen role; staff can see it too):
   - a date picker that defaults to today;
   - the production sheet;
   - the allergy sheet: children with allergens and their meal of the day, highlighted;
   - print-friendly CSS.
4. **Labels PDF** with the pure-JS PDF library from `docs/STACK_NOTES.md` (no headless Chrome):
   - an A4 label grid (default 3 × 8, configurable);
   - one label per child order: child name, class, date, meal, supplements, allergens highlighted;
   - sorted by class, then name.
5. **Exports**: Excel (exceljs) and CSV for a day, week or month, filtered by date range, class and meal type. Protect against CSV/Excel formula injection: escape cells that start with `=`, `+`, `-` or `@`.
6. If a query needs an index, add it with a migration, and check the heavy queries with `EXPLAIN`.

## Tests
- Aggregations on seeded data: cancelled orders excluded, holiday days empty
- Dashboard numbers
- PDF and exports generated, non-empty, with the right row counts
- Formula-injection escaping
- The kitchen role cannot change anything; parents have no access

Follow the subagent rules and report format in `CLAUDE.md`.
