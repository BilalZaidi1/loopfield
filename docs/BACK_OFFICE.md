# Back office (apps/admin)

Web console for running Loopfield: settings and kill switches, trust and safety queues, staff, jobs and the audit log. Next.js 16 on Vercel, in the app's November redesign (`docs/DESIGN.md`): the same tokens (`apps/mobile/src/theme/tokens.ts`, mirrored in `apps/admin/src/app/globals.css`), Figtree, the loop mark, pill buttons, flat cards and block colours, in light and dark.

## How it works

* **No backdoor.** The console signs staff in with Supabase Auth and calls the `ops_*` RPCs with the staff member's own session. Role checks, validation and the audit trail all live in Postgres, so the console and the app's operator screens can never disagree.
* **No secret key on Vercel.** The deployment only holds the project URL, the publishable key and a public Mapbox token.
* **Two-step sign-in.** Every console session must be MFA-verified (TOTP). The first sign-in enrols an authenticator app.
* **MFA in the database.** `app_config.ops_require_mfa` (default off) makes every `ops_*` function refuse sessions that are not `aal2`. Turn it on from App control → System once the app's operator screens prompt for TOTP; until then the console enforces MFA on its own.

## Roles

| Role | Can |
|---|---|
| admin | Everything, including tunables, releases, monetization, staff, jobs and the audit log |
| territory_operator | Kill switches (seasons, regions and exclusions arrive in Phase 2) |
| moderator | Moderation cases, content and account appeals |
| integrity_reviewer | Integrity cases, holds, competitive appeals |
| route_reviewer | Route proposals |
| support | Runner lookup (account tools arrive in Phase 3) |

### First admin

`ops_grant_role` needs an existing admin, so the first one is granted once in SQL:

```sql
insert into public.staff_roles (user_id, role)
select id, 'admin' from auth.users where email = '<your email>'
on conflict (user_id, role) do update set revoked_at = null;
```

## Run locally

```
cp apps/admin/.env.example apps/admin/.env.local   # fill in the publishable key
npm install
npm run dev -w @loopfield/admin                    # http://localhost:3100
npm run dev:fixtures -w @loopfield/admin           # sample data, no database or sign-in (dev only)
npm run typecheck -w @loopfield/admin && npm run lint -w @loopfield/admin && npm run test -w @loopfield/admin
npm run test:db                                    # includes supabase/tests/sql/12_backoffice.sql
```

## Deploy (Vercel)

* Project root directory `apps/admin`, framework Next.js, Node 22.x, function region `bom1` (beside Supabase ap-south-1).
* Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_APP_ENV` (`preview` / `production`).
* Keep Deployment Protection on for production as an outer gate.
* Migrations ship with the Supabase CLI, never from a Vercel build.

## Database

`supabase/migrations/*_backoffice.sql` adds:

* `internal.config_registry` (type, bounds, minimum role and help text per setting) and `internal.config_history`
* `ops_set_config` (validated, reasoned, audited change of any setting; core features can never be made premium), `ops_config`, `ops_config_history`
* `ops_overview` (Command Center), `ops_retry_dead_jobs`, `ops_staff_list`, `ops_users_search` (email lookups audited, addresses never returned), `ops_appeals_queue`, `ops_decide_account_appeal`, `ops_audit_log`, `ops_whoami`
* `ops_set_switch` (used by the app) now also covers `reclaim_enabled` and records history
* new settings `ops_require_mfa`, `maintenance_mode`, `latest_app_version`

## Status

Phase 0 and Phase 1 of the plan are built: sign-in with TOTP, Overview, App control (switches, tunables, releases, monetization, system, history), Moderation, Integrity, Appeals, Route proposals, Jobs, Staff and the Audit log.

Next:

* **Phase 2, game ops:** regions, districts and exclusion zones on a map; seasons and events; replay preview; territory inspector; challenges; movement ledger.
* **Phase 3, users and growth:** runner search and 360 view, account actions and the `ops-admin` edge function (sign-in bans, photo and raw-trace review via short-lived links, RevenueCat grants), push broadcasts, announcements, email, KPIs.
* **App changes:** read `maintenance_mode`, `latest_app_version` and announcements, refetch config on foreground, and add a TOTP prompt to the operator screens so `ops_require_mfa` can be switched on.
