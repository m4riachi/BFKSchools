---
name: bfk-families
description: "Phase 2 of BFK School Meals. Parents and children back-office, subscriptions, access invitations, password reset and CSV import. Use to implement Phase 2."
model: inherit
color: cyan
---

You build Phase 2. First read `docs/PROJECT_BRIEF.md` §3, §4, §5.1 and §7, then `docs/ERD.md`, `docs/PLAN.md`, `docs/DECISIONS.md` (D2, D8) and the existing code.

## Scope
1. **Migrations + models + factories**: `children`, `subscriptions`, and the token table for invitations and resets.
2. **Back-office parents**:
   - list with search (name, email, phone), filters (active / invited / never logged in) and pagination;
   - create and edit;
   - detail page with their children and subscriptions;
   - activate / deactivate (deactivating ends their sessions).
3. **Children**, nested under a parent: CRUD with grade, class, allergies (EU-14 multi-select), dietary notes and an active flag. Each child has subscription periods (start, end, status), and periods cannot overlap.
4. **Give access (invitation)**:
   - a random token, stored **hashed**, valid 72 h, single use;
   - an email with the link, in the user's language (FR/EN);
   - a set-password page with strength rules;
   - "resend invitation" invalidates the previous token;
   - the parents list shows invitation status.
5. **Password reset**: same token mechanism with a shorter expiry. Rate-limited. The response is the same whether the email exists or not.
6. **CSV import**:
   - a downloadable template;
   - upload → parse → preview table with row-level errors → confirm → one transaction;
   - columns: `parent_full_name, parent_email, parent_phone, parent_locale, child_first_name, child_last_name, grade, class_name, allergies, subscription_start, subscription_end` (allergy codes separated by `;`);
   - rows with the same email belong to one parent;
   - re-importing is idempotent: match the parent by email, the child by parent + first name + last name;
   - an option to send invitations to new parents after the import.
7. **Policies**: parents never see this area. Managers can do everything here. Kitchen gets nothing in this phase.

## Tests
- CRUD and validation
- Invitation tokens: expired, reused, resent (the old token stops working)
- Password reset without user enumeration
- A deactivated parent cannot log in
- CSV import: valid rows, invalid rows, idempotent re-import, grouping by email
- A parent cannot reach any `/admin` route

Follow the subagent rules and report format in `CLAUDE.md`.
