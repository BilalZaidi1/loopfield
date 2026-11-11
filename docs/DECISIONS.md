# Decisions and defaults

Choices made where the PRD (v1.2) or the build brief left room, recorded so they can be revisited. "Proposed" marks values that need field evidence before they are trusted (PRD §18).

## Product and rules

* **Working name.** "Loopfield" is a placeholder; naming and trademark clearance are open (PRD §22). Name, bundle ID and scheme are environment-driven. Branding, colours and icons are original.
* **Thresholds.** Every gameplay, validation and privacy number lives in `packages/core/src/rules/config.ts` with `status: 'proposed'` and its PRD source. Seasons pin rule versions (`territory-2026.11.0-proposed`, `speed-2026.11.0-proposed`) so past results replay under the rules that produced them. Key values: loop 1–30 km, candidate area ≤ 25 km², closure gap ≤ 20 m, 10 m inward uncertainty band, H3 resolution 11 for ownership and 10 for private exploration, 10 s maximum unresolved gap, speed courses 1–5 km with a 20 m corridor and 95 % coverage, gate fixes ≤ 4 s apart, title margin 1 % (widened by combined timing uncertainty), 30-minute publication delay.
* **Free-form loops, latest eligible loop wins.** Cell control is decided by verified completion time, never upload order; exact ties break by claim ID. Territory and speed are separate ledgers: a title never moves land and land never protects a title.
* **Fail closed on eligibility.** A claim in a region whose exclusion set has not been reviewed gets `eligibility_data_unavailable`; map appearance never authorizes a claim. Protected-area intersections withhold the whole shared claim, never a clipped outline.
* **Imported workouts are personal history only.** They cannot create tickets, claims, titles or ranked entries.
* **Development seed.** One clearly labelled development region (a rectangle in Karachi, chosen only because it is the founder's location) with two districts, one placeholder exclusion, one public competition and one season. No people, runs, posts or health data. The launch city is open.
* **Legal and consent versions** are placeholders (`2026-11-pilot-draft`, `2026-11-proposed-rules`, `2026-11`) until reviewed documents exist; the app says when documents are not yet published.

## Architecture

* **Backend authority.** The client records and previews. The server rebuilds geometry from uploaded evidence, validates, decides and publishes. Clients cannot write claims, titles, rankings or entitlements (RLS + grants, tested).
* **Published vs authoritative state** are separate tables, which is how the 30-minute publication delay and corrections work without leaking live positions.
* **Concurrency.** Transaction advisory locks on sorted H3 resolution-7 parent partitions serialize overlapping claims; jobs use `FOR UPDATE SKIP LOCKED` with backoff and dead-lettering.
* **H3** is not available as a Supabase extension, so cells are computed in TypeScript (`h3-js`) and stored as `bigint`; PostGIS remains authoritative for validity, area, inward band, containment, exclusions and masks.
* **One job system, two hosts.** The same handlers run in the `jobs` edge function (triggered every minute by pg_cron through pg_net, URL and secret in Vault) and in a Node container (`services/worker`). Either or both may run.
* **Shared rules engine.** `packages/core` is dependency-free TypeScript used by the app, the worker and (as a generated copy under `supabase/functions/_shared/core`) the edge functions. CI fails if the copy drifts.
* **Typed database access.** The app's Supabase client is typed from generated schema types, and `scripts/check-client-queries.mjs` checks select strings and RPC argument names against them, because supabase-js reports wrong columns only in result types.
* **Array parameters** are sent as explicit Postgres array literals (`pgArray`), because postgres.js mis-serializes arrays on a fresh connection.
* **Supabase CLI 3.0.0** is the pinned deployment tool (its remote flag is `--remote`; 2.x used `--linked`).

## Integrations

* **Email: one path.** Supabase's Send Email hook calls the `auth-email-hook` function, which sends through Resend with idempotency keys. No SMTP is configured, so Supabase never sends a second copy. Resend delivery webhooks (Svix signatures) suppress bounced and complaining addresses.
* **Webhook schemes are per provider.** Stream: HMAC-SHA256 of the raw body with the API secret plus the API-key header. RevenueCat: exact Authorization header value. Resend and the Supabase auth hook: Standard Webhooks (Svix) with a 5-minute timestamp tolerance.
* **Messaging (Stream Chat only).** Channels are created server-side after the recipient policy check (default: mutual followers; blocks always win). User tokens are minted by the backend after verifying the Supabase session and expire. Presence, read and delivery receipts, typing events, uploads, link previews and Stream's own push are off; users connect invisible. Group chat is deferred. Feeds and clubs stay in Supabase.
* **Push.** One path: the backend sends Expo pushes from `notifications` rows with generic previews (no message text, health readings or private route details), honouring quiet hours in the user's time zone, mutes and digests. Stream push is disabled to avoid duplicates; the push for the conversation currently open is suppressed on device.
* **Billing.** Free pilot: `paywall_enabled = false` and `premium_features = []`. RevenueCat purchase flow and server reconciliation are built and sandbox-testable; entitlements are written by the service role only, from authenticated webhooks plus REST re-checks, with grace periods, refunds and anonymous IDs handled. Core competition, basic social and health features, privacy and deletion can never be listed as premium.
* **Analytics.** PostHog EU, opt-in, explicit event allowlist with bucketed values; no autocapture, lifecycle events, session replay or GeoIP; identity is the internal user ID. No raw GPS, health readings, message text, auth details or free text.
* **Errors.** Sentry (EU region) with scrubbing of tokens, emails, coordinates, request bodies and user details before sending; replay, screenshots and view hierarchy off; source-map upload token only in build environments.
* **Maps.** Mapbox via `@rnmapbox/maps`; telemetry off, attribution and logo visible; public token in the app, download token only in builds. Viewport queries are capped at 0.06 deg² (server guard `zoom_in`), and the map has an accessible list alternative.
* **Health.** HealthKit (`@kingstinct/react-native-healthkit`) and Health Connect (`react-native-health-connect`). Readings stay on the device in a separate SQLite cache in the app's cache directory (Android backup is disabled), pruned after 90 days. Every reading keeps its source and method; HRV SDNN and RMSSD stay separate; missing data is never shown as zero; elevation from flights climbed is labelled as an estimate (×3 m). Disconnect revokes (Android) and clears the cache; sign-out and account deletion clear it too; records in Apple Health or Health Connect are never deleted. Workout export is a separate opt-in and uses a stable external ID so retries update one record.

## Data retention (server)

Raw competitive evidence: through the season plus 30 days after settlement, longer only while an integrity case is open. Notifications: 180 days. Webhook receipts: 30 days. Moderation evidence: 90 days after resolution. Data exports: download link valid 5 minutes, file expires after 72 hours. Account deletion runs as checkpointed steps (results, courses, social, chat, billing, storage, auth).

## Frontend redesign (6 Nov)

- **One design system, both themes designed.** Semantic tokens in `src/theme/tokens.ts` (light and dark palettes, colour blocks, territory and map colours). Module colours keep one meaning: violet = you and your land, blue = runs, orange = competition, green = health and goals. Text on blocks is chosen for 4.5:1 contrast (white on violet/blue, ink on orange/green).
- **Theme choice is per device.** System / Light / Dark in Settings, saved in AsyncStorage (`loopfield.theme`); the splash stays up until it is read, so the wrong theme never flashes. Native pieces follow via `Appearance.setColorScheme`.
- **Fonts without a native change.** Figtree (OFL) weights are bundled as JS assets and loaded at start-up with expo-font; no config plugin, so the build fingerprint and the installed pilot build are unchanged and the redesign ships as an update. If fonts fail to load, text falls back to system weights.
- **Map styling only.** Theme base maps (Mapbox `light-v11` / `dark-v11`, overridable with `EXPO_PUBLIC_MAPBOX_STYLE_URL[_DARK]`), new layer styling, a faint H3 grid drawn from the visible bounds (visual only; it never implies eligibility), cell and route panels from data already fetched. Ownership, scoring, speed and validation code is untouched.
- **Without a drawable map** (browser, Expo Go) the map screen summarises published cells around the last known or default start point instead of showing zeros.
- **Social sign-in is discovered, not assumed.** Buttons appear only for providers the Supabase project reports as enabled (`/auth/v1/settings`); OAuth uses PKCE through the existing `/auth/callback`. Age and terms consent stay in profile setup, so an OAuth account goes through the same gate.
- **First-run tour** (`(app)/tour.tsx`) shows once per account per device after onboarding and can be replayed from Help or Settings.
- **Reduce Motion** turns off the splash animation, press squeezes, the GO pulse, chart growth and the run-saved burst.


## Movement points, reclaiming and achievements (11 Nov)

These features were requested after PRD v1.2 and are not in it. Every number below is a proposed default kept in `app_config` (authoritative, changeable without a release) and mirrored in `MOVEMENT_RULES` / `ACHIEVEMENT_RULES` in `packages/core/src/rules/config.ts` (version `movement-2026.11.0-proposed`).

**Earning points**
- **Server-verified distance only.** The `jobs` runner evaluates each run's first-party evidence with `evaluateMovement` (core) after the run is processed, for public and private runs alike, and awards `floor(km × 10)` points once per run (`internal.award_movement_points`, one ledger row per run).
- **What does not count:**
  - A run with mocked locations earns nothing.
  - Distance is never bridged across a gap of more than 10 s or across a pause, so unrecorded movement is never reconstructed.
  - Segments faster than 12 m/s (GPS jumps) and stretches above 6.5 m/s sustained for 60 s (a vehicle) are left out. The rest of an honest run still counts.
  - A run with fewer than 30 usable fixes, or under 200 m of verified distance, earns nothing.
- **Daily cap.** 400 points per UTC day limits farming. A capped award is labelled on the run.
- **Self-healing.** The minute maintenance job gives any run from the last 30 days that was processed but never had its points evaluated another points job: at most three jobs per run, and never two at once. The one-off backfill for runs recorded before this release starts ten minutes after the migration, so a job runner still running the previous code cannot dead-letter it during a deploy.
- **Imported health workouts never earn points.** They never reach the server (health data stays on the device), and they remain personal history only.
- **Private stays private.** A private run earns points but still never posts, claims land or appears on a map or leaderboard. Only the runner can read their balance, ledger and per-run points (pgTAP).
- **Integrity reversals.**
  - Points are revoked when a run is deleted or its result is ruled invalid, and restored if that ruling is overturned.
  - The balance may go below zero rather than undoing cells already reclaimed.
  - Movement points never affect the ranking.

**Reclaiming**
- **Eligibility.** A cell is reclaimable only when all of these hold:
  - It is currently held by another runner through their loop.
  - The reclaiming runner held it earlier in the same season, through a claim that is still valid.
  - The season is active, reclaiming and capture are enabled, the region is active, and the runner shares territory.
- **Points buy back only what you lost.** Points can never buy ground the runner never held, and the server re-checks every cell in the reclaim transaction. Cells that changed hands meanwhile are skipped and not charged.
- **Reclaim mechanics.**
  - A reclaim is a one-cell claim (`loop_claims.source = 'reclaim'`) applied by the same engine as loops, so "the newest eligible claim wins" still holds.
  - Any later loop takes the cell again, so running beats points.
  - It is published at once, because a reclaim reveals no live position. The 30-minute delay exists for runs.
- **No ping-pong.** A cell someone took back from you with points can only be won back by running.
- **Atomic and idempotent.**
  - Each request runs in one transaction under the runner's movement lock, then the territory partition locks, in a fixed order.
  - The client sends one request ID per selection, so a retry returns the first result and charges once.
  - Limits: 30 requests an hour and 200 cells per request. `reclaim_enabled` is a kill switch.
- **Corrections.**
  - If the loop that took a cell is later ruled invalid, the points spent reclaiming it are refunded, with one notification.
  - If the runner's own earlier claim (the reason they could reclaim) is ruled invalid, every reclaim based on it is withdrawn.
- **Cost and balance.**
  - Cost is proportional to area: 1 point per 1,000 m², rounded up, which is 3 points for a resolution-11 cell (about 2,150 m²).
  - 1 km of verified running (10 points) therefore buys back about 3 cells, roughly 6,400 m². A 1 km loop can enclose up to about 80,000 m².
  - So running stays the main way to gain ground. Points soften a loss; they do not replace running.

**Challenges and ranking**
- **Challenges.** 24 challenges, four per category (distance, consistency, territory, exploration, community, competitive), one per tier (bronze, silver, gold, platinum). Progress comes only from server-side, still-valid evidence:
  - verified distance;
  - weeks with a run;
  - loop captures and defended cells;
  - exploration cells;
  - club membership, club-season loops and organised clubs;
  - route attempts and titles;
  - settled season placings.
- **Award and removal.** Badges are awarded automatically. Runners whose evidence changed are re-evaluated by triggers plus the minute maintenance sweep. A badge whose evidence is invalidated is removed. Each new badge notifies once.
- **Score.**
  - Score = sum of tier points (10 / 25 / 60 / 150) + 25 for each category with at least one badge.
  - It rewards difficulty and breadth, and equal scores share a rank.
  - The formula and the runner's own breakdown are shown in the app from the published config.
- **Scopes.** Everyone, country (from the home region's country code), region (needs a home city), friends (mutual follows) and club (members only).
- **Privacy.** Runners with private profiles are ranked but shown as "Private runner" to non-followers. Full private mode removes a runner from rankings. Blocks hide runners in both directions.
- **No new analytics events.** Nothing about points, reclaims or badges is sent to PostHog or Sentry.
