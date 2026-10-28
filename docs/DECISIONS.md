# Business decisions

Agents read this file before every phase. The main session writes the user's answers here.
While a decision is **pending**, agents build with the default and keep the alternative easy to switch to.

| # | Question | Status | Answer / default |
|---|---|---|---|
| D1 | Subscription billing: a fixed monthly fee, or each subscription meal billed at its own price? | answered | Each subscription meal billed at its snapshot price (`billing_mode=per_meal`; `monthly_fee` kept switchable) |
| D2 | Can a child without an active subscription order meals (pay per meal), or only supplements? | answered | Subscription meals need an active subscription; supplements are open to every active child |
| D3 | Default publish time of the weekly menu | answered | Thursday 10:00 of the previous week |
| D4 | Default order deadline | answered | Sunday 20:00 before the week |
| D5 | Changes after the deadline | answered | `allow_parent_edits` = true, `edit_mode` = `until_cutoff`, cutoff = the day before at 18:00 (`edit_cutoff_days_before` = 1, `edit_cutoff_time` = 18:00) |
| D6 | Does Britech School also close on Moroccan public holidays? | answered | Moroccan generator off; admin can switch it on in settings |
| D7 | Does the school publish an ICS calendar URL? | answered | No ICS URL; breaks imported by file upload or added by hand |
| D8 | Can one child be linked to two parent accounts (two guardians)? | answered | One parent account per child; schema kept open to a guardians pivot later |
| D9 | Allergy rule when a meal contains a child's allergen | answered | Block the selection |
| D10 | At the deadline, give the default meal to subscribed children with no choice? | answered | Yes — auto-assign the default meal at the deadline |
| D11 | Payment tracking ("mark as paid") in v1? | answered | No — statements only |
| D12 | Reminder delay before the order deadline | answered | 24 hours (`reminder_hours_before_deadline` = 24) |
| D13 | Password reset link lifetime | answered | 60 minutes (invitations stay 72 h) |
| D14 | Supplement quantity limit | answered | At most 5 per item per child per day (`supplement_max_quantity` = 5) |
| D15 | Hosting provides Node 24? | pending | Needed before Phase 9. If the cPanel host has no Node 24 → VPS / Docker host |
| D16 | Email delivery design | answered | `outbound_emails` outbox + `mail:dispatch` cron command, no queue package; invitations/resets sent directly. SMTP hourly limit still unknown (pending) |
| D17 | Can a parent who was never invited set a password through "forgot password"? | answered | No — reset links are sent only to accounts that already set a password (accepted an invitation); others get the same generic response and no email |
| D18 | Changes to a published menu | answered | Adding dishes is allowed. Changing a day's default meal is allowed only until the week's order deadline, and parents with children affected are notified (in-app + email). `max_quantity` can never be set below the quantity already ordered |
| D19 | Publishing after the order deadline has passed | answered | Manual "publish now" is refused when `order_deadline_at` has passed (staff must set new times). The job does not publish such a menu either: it leaves it scheduled and logs/alerts |
| D20 | Who can open the settings screen | answered | Admins only (managers get 403), per brief §3 |
| D21 | Do invited parents who haven't set a password receive menu emails? | answered | Yes — every active parent with an active child receives them |

## Change log
<!-- main session: one line per answer, e.g. "2026-11-02 — D1 answered: fixed monthly fee of 650 MAD" -->
2026-10-27 — Phase 0 approved; D1–D14 and D16 answered with the recommended answers (D5 cutoff: day before 18:00); D15 and the SMTP hourly limit pending
2026-10-28 — D17 answered: password reset only for parents who already accepted an invitation
2026-10-28 — D18–D21 answered with the recommended answers (published-menu changes, late publication, settings admin-only, invited parents get menu emails)
