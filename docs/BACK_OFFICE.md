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
* **App:** JavaScript only, so it ships as an over-the-air update to the pilot build (`apps/mobile/.eas/workflows/publish-pilot-update.yml`); see [App](#app) for what it reads. The server enforces every rule either way.

## App

The mobile app follows the back office through the database, without copies of server rules. Every value below is still enforced on the server; the app uses it to show the right thing instead of letting an action fail, and falls back to its built-in defaults when it cannot read it (a missing value never switches a check off).

### What it reads, and from where

| What | Read from | Where the app uses it |
|---|---|---|
| All readable settings | One query of `public.app_config` (row-level security returns the `is_public` rows): `src/lib/appConfig.ts`. Read on launch, whenever the app returns to the foreground, and every five minutes while it is open (`useAppConfigSync`, mounted once at the root); screens share the cached copy (`useAppConfig`) | Everything in this table that says "settings" |
| `maintenance_mode` | settings | Full-screen maintenance screen with the message and the "Back by" time (`src/features/system/SystemGate.tsx`). It waits while a run is recording or paused, then shows; the finished run stays queued and uploads as soon as maintenance ends (`src/state/services.ts`). Staff with any permission can tap *Continue as staff* for that maintenance window |
| `min_supported_app_version` | settings | Hard block: an *Update Loopfield* screen with a store button (never over a recording run) |
| `latest_app_version` (`ios`, `android`) | settings | *Update available* sheet with *Update* (opens the store) and *Not now*; shown once per version, remembered on the phone |
| Kill switches | settings | `comments_enabled`: comment box replaced by a paused note; `avatar_uploads_enabled`: photo and new-avatar buttons hidden with a note (both save pictures, see Known server gaps); `club_creation_enabled`: *New group* / *New community* hidden, create form disabled; `route_proposals_enabled`: *Propose* disabled with a note, propose form disabled; `territory_capture_enabled` and `speed_titles_enabled`: run types marked paused before a run, GO blocked with *Record privately instead*; `reclaim_enabled` (and capture): reclaiming shown as paused on the Map; `messaging_enabled`: Messages, conversations and *Message* on profiles show a paused note; `photo_uploads_enabled`: *Add photos* replaced by a note; `public_publication_enabled`: a note on the Map that results are held back. The server's `feature_paused` error stays as a fallback |
| `post_max_chars`, `post_max_photos`, `comment_max_chars` | settings | New post, sharing a run, comment box |
| `share_map_min_distance_m`, `share_route_trim_m`, `share_street_map_enabled` | settings | Share card: runs shorter than the larger of the minimum and 3 × the hidden distance share without a route, and the card says so; it also says when the street map is switched off |
| `disabled_health_cards` | settings | Health dashboard |
| `paywall_enabled`, `premium_features` | settings | Settings → Subscription and the premium gate |
| `achievement_tier_points`, `achievement_category_bonus` | settings | Ranking explainer |
| `movement_points_per_km`, `movement_points_daily_cap`, `rules_status` | settings | Help |
| `group_max_members` | settings | Group members |
| `integrity_overrides` | settings, read when a run starts | Live movement check |
| Game rules | `game_rules()`: `useTerritoryRules`, `useSpeedRules` in `src/lib/gameRules.ts`, read again when a screen opens and the copy is over a minute old | Live loop hint and GPS indicators, Help, the tour, the onboarding territory consent, propose-route validation, the route title margin, cell detail, and the "not counted" explanations on run results (with numbers only when the result was judged under the same rule version, or the built-in one) |
| Staff access and account status | `ops_whoami()`: permissions, role labels, `require_mfa`, status. Read at sign-in and again on returning to the foreground (at most once a minute) | Operator tools shown by permission, so custom roles work (`src/features/ops/tools.ts`); *Create an event*; the maintenance bypass; the suspended state |
| Kill switches for operators | `ops_config()` (category `switch`), changed with `ops_set_config` and a reason | Operator tools → System lists every switch the back office registers (`src/features/ops/SwitchList.tsx`) |
| Support | `support_unread_count()`, `support_inbox()`, `support_thread()`, `support_create()`, `support_reply()` | Badge on Settings → Message support (refreshed on focus and after any push); *Contact support* links that prefill `/support/new`: a run whose loop or route time did not count (`competition`, `run:<id>`), the suspended state (`account`, `account:suspended`) and error states (`bug`, `error:<message>`) |
| Authenticator code | Supabase Auth MFA (`getAuthenticatorAssuranceLevel`, `listFactors`, `enroll`, `challengeAndVerify`) | Every operator screen opens through `StaffGate` (`src/features/ops/StaffGate.tsx`): in an `aal1` session it asks for the 6-digit code, enrolling a TOTP factor first when the account has none, then continues at `aal2` |
| Supported areas | `districts` with their `regions` (shapes only when the runner taps *Use my location*) | City picker: areas grouped by country and region; *Use my location* finds the area containing the phone's position on the phone and names the place with the phone's own geocoder |

### Suspended accounts

A runner whose profile status is `suspended` sees a clear state where the server blocks them: Home (once), before a competitive run, New post and sharing a run, comments, Messages and conversations, creating clubs and proposing routes. Each offers *Message support* (support accepts suspended accounts) and the Appeals list. Private recording, history and support keep working.

### Testing on loopfield-dev

| In the back office | In the app |
|---|---|
| App control → Comments off | Within five minutes, or on reopening the app, the comment box says comments are paused |
| Maintenance on with a message (and optionally a time) | On launch or foreground the maintenance screen shows the message and "Back by"; a run that is recording continues and the screen appears after it finishes |
| Latest version above the installed one (Settings shows the installed version) | *Update available* appears once; *Not now* or *Update* remembers that version |
| Game rules: a shorter minimum loop, *apply now* | Help (opened again after a minute) and the live loop hint use it |
| Support inbox: reply | A push arrives, Settings → Message support shows the badge, and the conversation opens |
| A custom role with only `moderation` | Operator tools shows only the moderation queue, after the authenticator code |

### Known server gaps

Found while wiring the app; the server was left unchanged.

* **Drawn avatars are paused with photo uploads.** `avatar_uploads_enabled` gates every insert into the `avatars` storage bucket, and drawn avatars are saved there as pictures, so they are refused too, although the setting's help says "Drawn avatars keep working". The app pauses both. Letting drawn avatars through would need a storage policy change.
* **Suspended runners cannot file an appeal.** `submit_appeal` requires an active account (`internal.require_user()`), and there is no runner path that creates the `account_action` appeals `ops_decide_account_appeal` decides. The suspended state therefore leads with *Message support*, which works.
* **Paused reclaiming is reported as a closed season.** With `reclaim_enabled` off, `lost_cells` gives `season_closed` as the reason; the app shows "Reclaiming land with points is paused for now" instead.
* **Regions and districts cannot be edited in the console yet** (Phase 2). loopfield-dev has one development region, "Development region (Karachi test area)", split into *Dev South* and *Dev North* at latitude 24.89 (seed data); real cities need new region and district rows.

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
* **App:** done (see [App](#app)). `ops_require_mfa` can be switched on: the app's operator screens ask for the authenticator code first.
