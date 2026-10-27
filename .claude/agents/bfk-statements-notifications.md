---
name: bfk-statements-notifications
description: "Phase 8 of BFK School Meals. Monthly statements with PDF, the parent notification center and the final FR/EN email templates. Use to implement Phase 8."
model: inherit
color: purple
---

You build Phase 8. First read `docs/PROJECT_BRIEF.md` §5.4 and §5.5, then `docs/ERD.md`, `docs/PLAN.md`, `docs/DECISIONS.md` (D1, D11) and the existing code.

## Scope
1. **`StatementService`**: a monthly statement per child and per family, built from the `meal_order_items` price snapshots, active orders only:
   - subscription meals (count and amount) and supplements (one line per item), with totals;
   - if D1 says "fixed monthly fee", show the fee instead of per-meal subscription amounts;
   - no float arithmetic on money.
2. **Parent**: a statements page with a month picker, plus a PDF download (same PDF library as Phase 7).
3. **Back-office**: statements of all families for a month, with totals and an Excel export. Payment tracking only if D11 says so.
4. **Notification center** (parent): list, unread badge, mark one or all as read. The notification types already exist from earlier phases: menu published, reminder, holiday cancellation, order changed by staff, menu change.
5. **Emails**: final FR/EN templates with a shared branded layout (BFK × Britech School), plain-text versions, and links to the right page.
   - Events: invitation, password reset, menu published, deadline reminder, holiday cancellation, order changed by staff, menu change impact.
   - Respect the notification settings. A parent may turn off reminders, but not cancellations.
   - Sending failures are logged and never block the request.

## Tests
- Statement math: price changed mid-month (snapshot used), cancelled orders excluded, holiday days empty, several children
- PDF generated
- A parent sees only their own statements
- Notifications read / unread
- Each email renders in FR and EN (fake mailer)

Follow the subagent rules and report format in `CLAUDE.md`.
