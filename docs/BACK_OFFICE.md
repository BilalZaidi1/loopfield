# Back office (apps/admin)

Web console for running Loopfield: a customizable Overview, Analytics, runners and support, trust and safety queues, game rules and app settings, a read-only SQL editor, staff, roles and permissions, jobs and the audit log. Next.js 16 on Vercel, in the app's November redesign (`docs/DESIGN.md`): the same tokens (`apps/mobile/src/theme/tokens.ts`, mirrored in `apps/admin/src/app/globals.css`), Figtree, the loop mark, pill buttons, flat cards and block colours, in light and dark.

## How it works

* **No backdoor.** The console signs staff in with Supabase Auth and calls the `ops_*` RPCs with the staff member's own session. Permission checks, validation and the audit trail all live in Postgres, so the console and the app's operator screens can never disagree.
* **No secret key on Vercel.** The deployment only holds the project URL, the publishable key and a public Mapbox token.
* **Two-step sign-in.** Every console session must be MFA-verified (TOTP). The first sign-in enrols an authenticator app.
* **MFA in the database.** `app_config.ops_require_mfa` (default off) makes every `ops_*` function refuse sessions that are not `aal2`. The SQL editor always requires `aal2`.

## Roles and permissions

Access is granted through permissions (`internal.staff_permissions`); roles bundle them (`internal.staff_role_defs`) and are edited on **Roles & permissions**. Admin holds every permission. Admins can change what the built-in roles may do and create custom roles. Staff with the `staff` permission can grant roles, but never a role with permissions they don't hold themselves, and only admins grant admin. The last admin cannot be removed.

| Built-in role | Permissions |
|---|---|
| admin | everything |
| territory_operator | kill switches and seasons |
| moderator | moderation, view runners |
| integrity_reviewer | integrity cases, view runners |
| route_reviewer | route proposals |
| support | view runners, support inbox |
| analyst | analytics, SQL editor |

Other permissions: edit game rules, apply rules to running seasons, suspend and sign out runners, app settings, monetization, jobs, audit log, staff. `authz.has_role(user, name)` resolves role names to permissions, so every existing function and RLS policy follows the same model.

### First admin

`ops_grant_role` needs an existing admin, so the first one is granted once in SQL:

```sql
insert into public.staff_roles (user_id, role)
select id, 'admin' from auth.users where email = '<your email>'
on conflict (user_id, role) do update set revoked_at = null;
```

## Screens

* **Overview:** what needs a person now, alerts, and widgets each staff member picks and orders (Customize). Saved per person.
* **Analytics:** headline numbers against the previous period, daily trends, when and how far people run, loop outcomes and why loops fail, sign-up funnel, weekly retention, community, trust and support, platform. CSV export.
* **Runners:** directory with search, filters and sorting; runner profile with stats, runs, cases, support, account state and staff actions; suspend, reinstate, sign out everywhere, reset profile fields. Exact-email lookup is audited.
* **Support inbox:** conversations from Help and feedback in the app; assign, prioritise, reply (the runner is notified), internal notes, saved replies.
* **Game rules:** loop, GPS, vehicle and speed-route thresholds as versioned rule sets. A change starts with the next season; *apply now* moves running seasons. Shows what stays in code.
* **App control:** kill switches (now also comments, profile photos, club creation, route proposals), tunables, sharing (share-card map minimum, hidden start and finish, privacy-zone margin, publication delay, street map), season timings, post limits and anti-spam limits, releases, monetization, system.
* **SQL editor:** read-only SQL over curated views (`ops_sql` schema) with schema browser, autocomplete, saved and shared queries, history and CSV export. Routes, places, notes, messages, health data, privacy zones and emails are not in the views.
* Moderation, Integrity, Appeals, Route proposals, Jobs, Staff, Roles & permissions, Audit log.

## Run locally

```
cp apps/admin/.env.example apps/admin/.env.local   # fill in the publishable key
npm install
npm run dev -w @loopfield/admin                    # http://localhost:3100
npm run dev:fixtures -w @loopfield/admin           # sample data, no database or sign-in (dev only)
npm run typecheck -w @loopfield/admin && npm run lint -w @loopfield/admin && npm run test -w @loopfield/admin
npm run test:db                                    # includes 12_backoffice.sql and 13_backoffice_controls.sql
```

## Deploy

* **Console (Vercel):** project root directory `apps/admin`, framework Next.js, Node 22.x, function region `bom1` (beside Supabase ap-south-1). Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_APP_ENV` (`preview` / `production`). Keep Deployment Protection on for production.
* **Database and edge functions:** the *Deploy backend* workflow (`.github/workflows/deploy-staging.yml`) applies migrations and deploys every function. Game rule versions and season timings are read by the edge functions (`session-ticket`, `activity-upload`, `jobs`), so deploy them with the migrations.
* **App:** the support screens, the street-map switch and the live loop hint that follows the season's rules ship with the next app build. The server enforces the rules either way.

## Database

* `*_backoffice.sql`: config registry and history, `ops_set_config`, overview, staff, users search, appeals, audit log, `ops_require_mfa`, `maintenance_mode`, `latest_app_version`.
* `*_backoffice_rbac.sql`: permissions, role definitions, `ops_rbac`, `ops_save_role`, `ops_delete_role`, `ops_grant_role` with escalation guards.
* `*_backoffice_rules.sql`: `internal.rule_catalog`, `internal.rule_versions`, `internal.rule_next`, season pinning trigger and season timing columns, `game_rules()` for the app, `ops_rules`, `ops_save_rules`, `ops_set_next_rules`, `ops_apply_rules_now`, rate-limit overrides and action kill switches in `internal.enforce_rate_limit`, post and comment length limits, sharing settings in `internal.share_route` and `internal.share_payload`.
* `*_backoffice_support.sql`: `support_tickets`, `support_messages`, runner RPCs (`support_create`, `support_reply`, `support_inbox`, `support_thread`) and staff RPCs (`ops_support_*`).
* `*_backoffice_users.sql`: `ops_users_list`, `ops_user_overview`, `ops_set_user_status`, `ops_sign_out_user`, `ops_reset_profile`.
* `*_backoffice_analytics.sql`: `internal.metrics_daily` (hourly via `loopfield-backoffice`), `ops_metrics`, `ops_analytics_breakdowns`, `ops_analytics_funnel`, `ops_analytics_retention`, staff preferences.
* `*_backoffice_sql.sql`: `ops_sql` views, the `loopfield_sql_reader` role, `ops_sql_run` (read-only, rolled back, row-capped, audited), saved queries.

## Next

* **Phase 2, game ops:** regions, districts and exclusion zones on a map; seasons and events; replay preview; challenges; movement ledger.
* **Phase 3, growth:** push broadcasts, announcements, email.
* **App:** read `maintenance_mode` and `latest_app_version`, and add a TOTP prompt to the operator screens so `ops_require_mfa` can be switched on.
