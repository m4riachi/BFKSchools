# Business decisions

Agents read this file before every phase. The main session writes the user's answers here.
While a decision is **pending**, agents build with the default and keep the alternative easy to switch to.

| # | Question | Status | Answer / default |
|---|---|---|---|
| D1 | Subscription billing: a fixed monthly fee, or each subscription meal billed at its own price? | answered | **Superseded by D31 (2026-10-29).** Was: each subscription meal billed at its snapshot price |
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
| D22 | Does the kitchen cutoff apply before the week's order deadline? | answered | No — brief §5.6: before the deadline parents change freely (except locked days); the cutoff applies only after the deadline. In `same_day_only` mode `edit_cutoff_days_before` is ignored |
| D23 | How far back can staff change orders? | answered | Only dates in the current calendar month (school time zone); older dates are refused even for admins |
| D24 | Can a parent re-order a day that staff cancelled? | answered | No — days cancelled by staff (`staff`) or for an inactive child (`child_inactive`) can only be re-opened by staff |
| D25 | Price when staff switch an order to another meal (menu change) | answered | The parent keeps the original price when the new meal costs more; if it costs less, the lower price applies |
| D26 | Phase 7 report conventions | answered | "Tomorrow" on the dashboard = next school day; "% with a selection" = subscribed active children with an order row for every open day they are subscribed on; the allergy sheet lists only children who eat that day; kitchen exports have no prices; labels sorted by class, last name, first name |
| D27 | PDF render limit fairness | answered | Per-user cap on PDF renders: 1 running + 1 waiting per user (on top of the server-wide gate); extra requests get 429/503 with Retry-After |
| D28 | Parent emails in the statements Excel export | answered | Drop the email column — the export keeps names, children and amounts only |
| D29 | `monthly_fee` billing rule | obsolete | Made obsolete by D31 (subscription meals are free); `billing_mode`/`monthly_fee` removed from settings and statements |
| D30 | Parent "change password" page (brief §5.5) | answered | Build it in Phase 9 under the parent "Compte" tab (current password + new password; ends other sessions like a reset) |
| D31 | Do subscription (abonnement) meals have a price? | answered | No — subscription meals are free in the app: no price field, `price_cents = 0`, never charged. Only supplements are priced and billed. Statements and totals show supplements only (subscription meals may be listed/counted as "inclus"); this applies to every month, including subscription order lines priced before D31. Replaces D1 |
| D32 | BFK restaurant menu in the catalog | answered | The 181 dishes and drinks of the BFK ordering site (names, FR/EN descriptions, prices, photos, taken 2026-10-29) are seeded as **inactive supplements** (`node ace bfk:seed catalog\|demo`, key `external_recipe_ref = bfk-site:<id>`). Allergens are unknown (empty) and prices are the restaurant's: staff set allergens and the school price before activating a meal. The 9 generated demo supplements are removed; the demo activates 8 BFK menu items instead (`DEMO_ACTIVE_SUPPLEMENTS`) |
| D33 | Can allergens, labels, Niveau and Classe be turned off? | answered | Yes — modules in `/admin/settings`, **off by default**: `grade_enabled` / `class_enabled` (off = field hidden from forms, lists, production breakdown, labels, exports and statements; stored values kept); `allergens_enabled` (off = no allergy check when ordering, auto-assigning or switching meals; no allergen on any screen, label or export; `/kitchen/allergies` → 404) and `labels_enabled` (off = `/kitchen/labels` and its PDF → 404, no nav link). Stored allergen data is kept and comes back when the module is turned on |
| D34 | How do parents reach support? | answered | Setting `support_whatsapp` in `/admin/settings` (international number, stored as digits only; a local 06… number is refused because wa.me needs the country code). When set, parents get a WhatsApp icon above the bottom navigation opening `https://wa.me/<number>`; empty = no icon. Parent portal only, not the login page or the back-office |
| D35 | Amount of one subscription meal | answered | Setting `subscription_meal_price_cents` in `/admin/settings` (admin only, optional, centimes). **Stored and shown on that page only for now:** nothing reads it, so D31 still applies (subscription meals are not billed, no price on statements or snapshots). Default 50 MAD (5000), also when the field is emptied. Applied by D36 and D38 only |
| D36 | Revenue API for another app | answered | `GET /api/v1/revenue/daily` (`?date=`, or `?from=&to=` up to 366 days, default today), headers `X-Api-Key` + `X-Api-Secret`, one pair per school, shown in `/admin/settings` (admin only). Revenue of a day = subscription meals × `subscription_meal_price_cents` + extras' snapshot amounts, active orders only. The amount is **the current setting, not a snapshot**: changing it changes past days. Today and later are `provisional`. Statements and parents do not change (D31). The secret is encrypted with APP_KEY rather than hashed, because admins must be able to display it again |
| D37 | Links of the "Commande à domicile" and "Glovo" buttons | answered | Settings `delivery_order_url` and `glovo_url` in `/admin/settings`, https only, default to the BFK Marrakech store and the Glovo page (without ad-tracking parameters). Empty = no button. Parent portal only |
| D38 | Back-office reports page | answered | `/admin/reports` (admin + manager), period from/to, default this month: revenue (D36 formula), subscription meals, extras + top 10, active subscriptions today, clicks and distinct parents on the Glovo and home delivery buttons, per day. Clicks go through `GET /out/glovo` and `/out/delivery` (parents only), which store user + button + time in `link_clicks` (no IP) and redirect. Charts per day, per week beyond 62 days. A click means the parent opened the site, not that they ordered. No history before this feature |
| D39 | Staff ordering for parents who do not choose | answered | `/admin/pos` (admin + manager): search a family, pick a child, choose meals. Same rules as the child's week page through `OrderService` (time locks can be overridden, audited as `staff_override`, parent notified); the audit reason is filled in automatically. `meal_orders.origin` now says who chose last (`staff` or `parent`) and shows as "Passée par l'admin" on the day card and the orders list. Billing is unchanged |
| D40 | Reuse an old menu | answered | In the builder of a draft week, "Copier un ancien menu" lists up to 26 earlier weeks with a menu; applying one replaces the draft's dishes (same weekday, holidays and inactive meals skipped and reported, confirmation when the week already has dishes). The old menu is not changed |
| D41 | Hours shown in the browser | answered | Morocco returned to UTC on 20 Sep 2026 (decree 2.26.530), but browsers can carry old time zone data (Chrome 146 still says UTC+1). The server shares a table of Casablanca's offsets (`zoneOffsets`, built from its own data) and `formatDateTime` uses it instead of the browser's data. Server, Node and PostgreSQL must have time zone data from 2026 or later; `tests/unit/time_zone.spec.ts` fails if not |
| D42 | Staff users, roles and permissions | answered | `/admin/users` and `/admin/roles`, admins only. Staff join by invitation; accounts are deactivated, never deleted; nobody changes their own role or deactivates themselves. Built-in roles stay (admin, manager, kitchen). Custom roles = name + areas (`app/enums/permissions.ts`), per school. `users.role` stays the access level (kitchen when the role only opens the kitchen, otherwise manager), so data rules are unchanged and permissions only narrow them, in `PermissionMiddleware`. A route in no area is admin-only. Users, roles and settings are never assignable, so nobody can give themselves more. Amounts in the dashboard and exports need `statements` or `reports`. Known gap: admins can change each other without re-entering a password, and staff changes have no audit trail |
| D43 | Invite parents on WhatsApp | answered | Click-to-chat, no WhatsApp Business account: "Inviter par WhatsApp" on the parent page issues the same 72-hour invitation (previous link stops working) and opens `wa.me/<number>` with the message ready; staff press Send. Numbers written 0… are read as Moroccan (212). No email goes out. The sending cannot be confirmed, so the status says invited as soon as the link is created. Staff handle the raw link, which is flashed once in the encrypted session |
| D44 | School name | answered | The school is shown as "British Academy School Marrakech" everywhere (screens, emails, PDFs, exports); existing rows are renamed by a migration. The slug `britech-school` stays, it is internal. The academy logo in the parent header links to https://basm.uk/ |
| D45 | Animated logo at launch | answered | Phones draw their first screen from the static icon, which cannot animate. `public/splash.js` then shows `bfk-logo-animated.svg` on white in the installed app only, once per launch, at least 1.8 s and at most 6 s |

## Change log
<!-- main session: one line per answer, e.g. "2026-11-02 — D1 answered: fixed monthly fee of 650 MAD" -->
2026-10-27 — Phase 0 approved; D1–D14 and D16 answered with the recommended answers (D5 cutoff: day before 18:00); D15 and the SMTP hourly limit pending
2026-10-28 — D17 answered: password reset only for parents who already accepted an invitation
2026-10-28 — D18–D21 answered with the recommended answers (published-menu changes, late publication, settings admin-only, invited parents get menu emails)
2026-10-28 — D22–D25 answered with the recommended answers (cutoff per brief §5.6, staff edits current month only, no parent re-open of staff-cancelled days, switch keeps the lower price)
2026-10-28 — D26 recorded: Phase 7 report conventions kept as built
2026-10-29 — D27, D28, D30 answered with the recommended answers; D29 (monthly_fee rule) left pending until monthly fees are used
2026-10-29 — D31: subscription meals are free (no price, not billed); only supplements are billed. Supersedes D1
2026-10-29 — D29 obsolete (D31); D31 clarified: pre-D31 priced subscription lines are never billed
2026-10-29 — D32: BFK restaurant menu (181 items) seeded as inactive supplements; staff review allergens and prices before activating
2026-10-30 — D33: allergens, labels, Niveau and Classe are optional modules in the settings, off by default
2026-10-30 — D34: support WhatsApp number in the settings, icon in the parent portal
2026-10-30 — D35: amount of one subscription meal added to the settings
2026-10-30 — D36: revenue API with public + secret key per school, using the D35 amount
2026-10-30 — D37: link of the home delivery button in the settings
2026-10-30 — D38: reports page in the back-office, clicks on the Glovo and home delivery buttons counted
2026-10-30 — D35: the amount of one subscription meal defaults to 50 MAD, for past days too
2026-10-30 — D39: staff ordering desk, orders tagged when placed by admin
2026-10-30 — D40: copy the menu of any earlier week into a draft week
2026-10-30 — D41: hours in the browser follow the server's Casablanca time data
2026-10-30 — D42: staff users, custom roles and permissions
2026-10-30 — D43: parent invitation on WhatsApp through click-to-chat
2026-10-30 — D44: school renamed British Academy School Marrakech
2026-10-30 — D45: animated logo when the installed app starts
