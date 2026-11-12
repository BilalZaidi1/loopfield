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

## Enhancement release (11 Nov)

Requested on 11 Nov in a 15-section brief, outside PRD v1.2. Traced as EN1–EN15 in `TRACEABILITY.md`. Every number below is a proposed default; most are rows in `app_config` and change without a release.

**Run map and movement integrity (sections 1 and 3)**
- **Live map.** The full-screen map follows the runner through Mapbox's own viewport (no JavaScript per frame). Panning, pinching or rotating hands the camera to the runner; the recenter button, or 15 seconds without touching, brings following back. 3D (on by default) adds perspective, a course-up bearing and extruded buildings; terrain stays off while recording to save battery. Where no map can be drawn (browser, Expo Go) the screen leads with the numbers.
- **What a human can do.** The phone and the server compare speed over 20 s, 60 s, 3 min and 10 min windows with an envelope from the men's outdoor world records (100 m to the marathon) plus 10% for GPS error. One or two fixes that jump away and come back are a GPS spike and are ignored; speeds are median-smoothed over 5 fixes.
- **On the phone.** 30 s at vehicle speed: warning. 60 s above the record envelope or 120 s at vehicle speed: recording pauses, with the reason on screen. At 10 km/h or faster, under 100 steps a minute for 60 s flags the run (a bike); for 180 s pauses it. Only a yes/no "no running steps" window is uploaded, never step counts.
- **On the server.** An implausible run never changes land: its loops are held for review, the run is marked on the integrity trail, and the runner sees why and can appeal. A reviewer who finds a GPS error clears the flag and credits the left-out distance back. Thresholds are in `INTEGRITY_RULES`, overridable through `integrity_overrides`.

**All-time map, season races and events (section 5, "Separate season race")**
- **Layers.** Each region has a permanent *all-time map* (one season that never ends): land stays until someone takes it. The *season race* keeps its seasons and starts empty each time. *Events* (territory or distance, individual or club against club, public or members-only, at most 120 days) and *club races* have their own standings.
- **One run, several layers.** A run's loop is evaluated once and copied as a derived claim into every layer it belongs to, each scored by that layer's own season boundaries. Decisions on the run (invalidation, restoration, deletion) cascade to every copy.
- **What carries over.** Badges, points, exploration and the all-time map never reset. Points cannot reclaim land inside events (only running counts there).
- **One message per run.** Land notifications and digests come from the all-time map and club races only, never once per layer.
- **Events end cleanly.** At the end, standings are frozen, the event is archived and participants are told their place. Hosts can cancel before the end; participants are told.

**Shared runs (sections 4 and 9, "recommended" route privacy)**
- **What a share shows.** The route minus its first and last 200 m (`share_route_trim_m`), minus any protected area (buffered 50 m), simplified; published no earlier than the 30-minute delay. Time and pace are shown, as requested, because they say how quickly the area was covered.
- **Heart rate.** Average heart rate and energy can be added to an exported image only. They are read from the phone at export time and drawn into the image on the phone; they are never uploaded, stored on a post or sent to Supabase, PostHog or Sentry. A post shows no health values.
- **Links and QR codes.** A public run page (`/a/<token>`) shows exactly what the card shows and stops working the moment the runner turns the link off. Tokens are random and unguessable; pages are not searchable.
- **Formats.** 9:16, 4:5 and 1:1 images at 1080 px wide, saved or handed to the system share sheet. Direct Instagram Stories needs a Meta app ID (manual step A12); video export is not built.

**Communities and groups (sections 6–8)**
- **Two products.** A *group* is a private crew of at most 100 people (`group_max_members`), joined only by invitation, with a backend-managed chat (Stream channel type `loopfield_group`; members cannot add themselves). A *community* is public or members-only, with requests, admins, rules, announcements, a members' race and challenges.
- **Roles.** Owner, admin (stored as `organizer`) and member. Only the owner changes admins. Admins approve requests, invite, remove members and moderate.
- **Hand-over.** Ownership moves only when the chosen member accepts (offers expire after 7 days); the previous owner stays on as an admin. An owner with members cannot leave without handing over (section 8 step 1). If an owner disappears (account deleted or removed), the longest-serving admin takes over, otherwise the longest-serving member; with nobody left the club closes.
- **Deletion.** Requires typing the name. Members are notified; posts leave every feed; the members' race ends; running challenges are cancelled; images and the group chat are deleted by a job. Runs, the all-time map and members' posts elsewhere are untouched. An archived row stays for the audit trail only.
- **Branding.** Logo and cover (or one of six original artworks) in a private bucket, re-encoded on the phone (location metadata removed), previewed before saving, shown on lists, posts, events and profiles.

**Notifications and email (sections 11 and 12)**
- **Land changes.** A runner's own captures appear and can be pushed once published ("your land is on the map"). Land other runners take appears in the in-app list but is never pushed one by one: the push remains the daily digest (PRD §7, no live invasion alerts). These items never name the other runner and give a district, not a street.
- **Contested land.** A loss counts as *contested* when at least 2 different runners took cells from you within 7 days (`contested_min_runners`, `contested_window_days`); at most one such item every 3 days.
- **Friends' runs.** Only mutual follows, only posts they can already see, and pushed only if the runner turns that on (off by default).
- **Push switches.** Social, messages, communities, your runs and badges, events and challenges, the daily land update, and product news. Quiet hours hold pushes; everything still appears in the list.
- **Email.** Every email that could be sent has one outbox row keyed by a dedupe key, so it goes out at most once; Resend's idempotency key covers retries. Preferences and suppressions (bounces, complaints) are re-checked at send time. Refusals Resend will not accept again (for example a 4xx) are recorded and not retried; transient failures retry with backoff, then are recorded.
- **Email defaults.** Account and security email always. Communities and groups, and events and results: on. Run summaries and the daily land email: off (they would be frequent). At most 3 invitation emails a person a day (`invite_emails_per_day`); further invitations stay in the app.
- **Email content.** Branded, readable on a phone and in dark mode. Emails carry no heart rate, routes, maps or precise places, and buttons open the web version (`APP_WEB_URL`) because most mail apps do not open custom-scheme links.
- **Unsubscribing.** Optional emails carry a one-click unsubscribe (RFC 8058 headers) and a "Stop these emails" link to a web page. Both use a random per-person token, so no sign-in is needed. Opening the page changes nothing until the button is pressed.
- **Security notices.** Password, email, phone, sign-in-method and verification-method changes go through the same Send Email Hook as sign-up and recovery; they must also be switched on in the Supabase dashboard (A4). An email change notice goes to the old address.
- **Retention.** The outbox holds ids and counts, never addresses, for 180 days, like notifications.

**Avatars on the map (section 2)**
- **One picture.** A runner's picture is a photo or an original cartoon avatar. The cartoon is saved as an image in the runner's own avatars folder, so it shows wherever a profile picture does; its parts are stored to edit it, and the last photo is kept to switch back. The database checks the parts and that every picture path is in the runner's own folder.
- **On the map.** At zoom 13 or closer, each runner holding land in view (up to 60) gets a circular pin on their own land: the visible cell nearest the middle of their visible cells, so the pin never stands outside oddly shaped land. Pins that would overlap within about 56 px share one, led by the runner with the most land in view, with a count (tapping zooms in); native collision handling hides the rest.
- **The card.** Tapping a pin shows the runner's land in that layer, their rank, their cells in view and a link to their profile. Blocked runners show no name or picture.

## Owner feedback round (12 Nov)

Reported on 12 Nov from the pilot APK. Traced as FB1–FB8 in `TRACEABILITY.md`.

- **One recorder.** The Record button opens a full-screen map. Before the run, the bottom panel holds the four run types, a line on what the chosen one does and where it counts, the loop-capture switch or the chosen route, anything that blocks a competitive run, and GO. GO starts the run on the same screen: the map stays, and the panel becomes distance, time, pace, Pause and Finish. Discarding a run returns to choosing. Closing the recorder during a run leaves it recording; the Record button brings it back. Where no map can be drawn (browser, Expo Go) the same steps appear as ordinary screens.
- **Live numbers fit.** Each number is measured at full size and set smaller only when it would not fit its column; it is never cut short. Units sit beside the number in smaller type.
- **Share card map.** A Mapbox static street map (`mapbox/dark-v11`, Mapbox logo and attribution kept) of exactly the area of the drawn route sits under it: the drawing and the map use the same Web Mercator projection, centre and zoom (two decimals, never closer than zoom 17). The request carries only that centre and zoom, never the route. If the map cannot load, the route is drawn alone as before. A switch turns the map off.
- **Short routes stay private.** Unchanged rule: a route is shared only if something is left after hiding its first and last 200 m (`share_route_trim_m`), so runs under 600 m share no route. Their card shows the loop mark and a larger distance instead of an empty panel, and the share screen says why.
- **Runner's picture.** The card shows the runner's profile picture (photo or avatar), or their initial without one. The image is taken only once the picture and the map have loaded or failed.
- **Community colour.** Owners and admins pick one of the app's five block colours (violet, blue, green, orange, ink) and a cover design (Plain or one of the six artworks); communities can still use a photo. The colour tints the cover, its artwork, the monogram and the cards everywhere; without a choice the colour derived from the id stays. The logo keeps a ring in the page colour on the page and in Manage.
- **Creating.** "New community" starts a community and "New group" a group; the form no longer offers the other.
- **Health screens.** Each metric gets the form that suits it: steps as columns per day against the period's average; active calories as a calendar; sleep as time asleep per night, the typical night and an average night's stages; heart rate as each day's lowest to highest with the average; resting heart rate as a 7-day average over the daily readings; HRV with your usual range (the middle half of your readings); VO₂ max as its estimates over time. Periods longer than 31 days are drawn in weeks. There is no list of every day: the numbers (only days or weeks with readings) are one tap away. A period without readings says where they come from.
- **Chart rules.** Single series in the health green; columns at most 24 px wide with 4 px rounded tops and 2 px gaps; 2 px lines; markers ringed in the surface colour; hairline axes; tap to read a value. The calendar uses a five-step green ramp and sleep stages use four hues, each checked with the dataviz validator against the light (`#FFFFFF`) and dark (`#1C1D22`) card colours. Hero figures use the sans face.
- **Shipping.** No new native modules, so this reaches the pilot APK as an over-the-air update.

