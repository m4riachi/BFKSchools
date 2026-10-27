# Business decisions

Agents read this file before every phase. The main session writes the user's answers here.
While a decision is **pending**, agents build with the default and keep the alternative easy to switch to.

| # | Question | Status | Answer / default |
|---|---|---|---|
| D1 | Subscription billing: a fixed monthly fee, or each subscription meal billed at its own price? | pending | Default: each meal billed at its snapshot price |
| D2 | Can a child without an active subscription order meals (pay per meal), or only supplements? | pending | Default: subscription meals need an active subscription; supplements are open to every active child |
| D3 | Default publish time of the weekly menu | pending | Default: Thursday 10:00 of the previous week |
| D4 | Default order deadline | pending | Default: Sunday 20:00 before the week |
| D5 | Changes after the deadline | pending | Default: `allow_parent_edits` = true, `edit_mode` = `until_cutoff`, cutoff = same day 09:00 (`edit_cutoff_days_before` = 0) |
| D6 | Does Britech School also close on Moroccan public holidays? | pending | Default: Moroccan generator off; admin can switch it on in settings |
| D7 | Does the school publish an ICS calendar URL? | pending | Default: none; breaks imported by file upload or added by hand |
| D8 | Can one child be linked to two parent accounts (two guardians)? | pending | Default: one parent account per child; schema kept open to a pivot table later |
| D9 | Allergy rule when a meal contains a child's allergen | pending | Default: block the selection |
| D10 | At the deadline, give the default meal to subscribed children with no choice? | pending | Default: yes |
| D11 | Payment tracking ("mark as paid") in v1? | pending | Default: no — statements only |

## Change log
<!-- main session: one line per answer, e.g. "2026-11-02 — D1 answered: fixed monthly fee of 650 MAD" -->
