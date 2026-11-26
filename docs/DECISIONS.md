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

## Back-office sync (18 Nov)

Traced as BS1–BS12 in `TRACEABILITY.md`; what the app reads is listed in `BACK_OFFICE.md` ("App").

- **Settings cadence.** One query loads every readable setting; it is read again whenever the app returns to the foreground and otherwise every five minutes while it is open, from a single observer at the root so screens never poll on their own. A value that is missing or malformed falls back to the built-in default; a switch is never turned off by a parsing problem, because the server enforces it anyway.
- **Minimum version is a real block.** The old banner became a full-screen *Update Loopfield* screen, as the back office calls it a forced update. Like maintenance it waits for a recording run to finish.
- **Maintenance holds uploads.** Finished runs stay queued on the phone while maintenance is on and upload when it ends, so nothing reaches the server mid-maintenance. Staff who continue past the screen are held the same way.
- **The installed version** is the native build's version (`expo-application`), which over-the-air updates never change. Settings shows it with the running update's id, and support messages carry both.
- **Update prompt** is a bottom sheet, once per published version (remembered on the phone, not per account), never over a run that is recording. Android opens the Play Store page for the package; iOS opens the App Store page once `EXPO_PUBLIC_IOS_APP_STORE_ID` is set.
- **Profile pictures pause together.** `avatar_uploads_enabled` blocks every new picture in the avatars bucket on the server, drawn avatars included, so the app pauses both (switching back to an earlier photo still works). *Superseded the same day: drawn avatars keep working, see "Location and review fixes".*
- **Rule numbers in explanations** come from the rule version the result was judged by: the running season's when the versions match, the built-in rules when those were used, otherwise the general wording. Game rules are read again when a screen opens and the copy is over a minute old.
- **Permissions, not role names.** `ops_whoami()` replaces `my_staff_roles`; it is read at sign-in and again on returning to the foreground (at most once a minute), together with the account status, so a new role or a suspension reaches an open app.
- **Authenticator code once per session.** Every operator screen goes through `StaffGate`; a verified code moves the session to `aal2` and the app keeps the screen (the session reload skips `MFA_CHALLENGE_VERIFIED`). Enrolment clears unfinished factors first and offers the authenticator link, a QR code for another device and the key to type.
- **Location for the city picker** is read once on request. Which area contains it is worked out on the phone from the districts' shapes; the place name comes from the phone's own geocoder (none in the browser, where the area's country is shown). Outside every area the detected city becomes the profile's city label without an area, since rankings and Discover work by area. Country names are bundled because Hermes has no `Intl.DisplayNames`. *Superseded the same day by "Location and review fixes".*

## Location and review fixes (18 Nov)

Decided by the owner after the back-office sync: Loopfield is global, so a runner's place is their city and country anywhere, not a drawn district; and the three server gaps found during the sync are fixed (traced as BS13–BS16).

- **Country and city on the profile.** `profiles.country_code` (ISO 3166-1 alpha-2) and `city_label` (the city's name only). They show with the profile ("Karachi, Pakistan") and decide the City and Country rankings, Discover (runners, posts, communities) and a new community's home city. A profile without a country still counts in its district's country for rankings.
- **The phone's own geocoder, not Mapbox.** *Use my location* asks the phone once; Android's and iOS's geocoders name the city, country and neighbourhood worldwide at no cost. Mapbox's geocoding was not used because its results may only be stored with paid permanent geocoding. The position is never sent anywhere; in the browser, which has no geocoder, the country comes from the playing area when there is one and the city is typed.
- **The neighbourhood is private by default.** It lives in `user_settings.area_label` (only its owner can read the row) and `profile_card` returns it only when the runner turns on *Show my area on my profile*. Clearing the city clears the area, also when staff reset the city.
- **City matching is by name.** The server compares city names without case or extra spaces. Phones set to different languages can name the same city differently; every part is editable, and that is the known limit of a free geocoder.
- **Playing areas are not chosen by hand any more.** Districts stay for the territory game. The phone checks whether its position lies in one and stores it as the profile's district, so a new community still gets its members' race there; removing the location clears it. The district chips ("Dev North", "Dev South", the dev database's two test halves of Karachi) are gone from the profile; the land leaderboard still filters by district.
- **Older app versions keep working.** The recreated RPCs keep their district parameters (`p_country` and `p_city` are added after them) and the ranking still accepts `region`, now meaning `city`.
- **Drawn avatars while photos are paused.** The storage policies let `<user>/avatar-cartoon-*.jpg` through with `avatar_uploads_enabled` off, as its help text promises; the app keeps *Avatar* and hides only *Photo*. The server cannot tell a drawn picture from a photo, so a modified app could slip a photo through under that name; moderation still applies.
- **Reviews for suspended runners.** `submit_appeal` accepts suspended accounts (deleted ones stay out) and `account_action` for the runner's own suspension, without the seven-day window, once per suspension: `profiles.status_changed_at` (set by a trigger on every status change) names the suspension, so the unique key refuses a second request and a later suspension can be appealed again. Suspended runners may also appeal other decisions. Accepting in the console reinstates the account.
- **A paused reclaim says so.** `my_lost_cells` reports `reclaim_paused` when `reclaim_enabled` or capture is off and `season_closed` only when the season is not running.

## Running features, stage 1 (25 Nov)

Features 1 (route builder, offline routes, off-route alerts), 2 (live link) and 11 (the runner's picture as their position dot) from the running-features plan (traced as RF1a–RF11). The owner asked for all four stages' app work before the back office, so the stage's three open decisions were taken at the plan's recommendation; each is a setting or switch and changes without a release.

- **Standing live links: offered** alongside links for one run. While one is on, the Record tab says so before GO, with *Not this run*; Privacy → Live location has *Send the link again*, *Change the link* (the old one stops at once) and *Turn off*.
- **Live links hide positions inside protected areas by default.** A position within an area's radius plus the larger of the runner's privacy margin and 50 m is never sent to the page; the trail simply stops there and the page says the runner is in one of their protected areas. *Show my position everywhere* is chosen per link.
- **Path-following budget: 200 legs per runner per day** (`route_snap_daily_cap`). The monthly alert level (`route_snap_monthly_alert`) starts at 0, meaning no alert, for the back office to set.
- **Planned routes are private and measured by the database.** Encoded polylines (precision 5); the database computes distance, point count and whether the route is a loop (longer than 180 m with ends within 60 m), refuses lines under 50 m or over 200 km and more than `planned_routes_max` (100) routes; the app may write only the name, line and path-following flag. A copy stays on the phone so a route can be followed with no signal; it is removed at sign-out, with the offline maps and the picture marker.
- **Following is guidance only.** Off the route means more than `off_route_distance_m` (40 m) from the line for `off_route_seconds` (15 s); back on means within 25 m; fixes less accurate than 30 m are ignored; matching looks near the last match and costs a little for going backwards, so an out-and-back or a loop crossing itself doesn't jump. Land, loops and speed times are judged on what was run, as before. The check runs in the background location task and keeps its state in SQLite; a backgrounded app also gets a local notification when the runner goes off the route.
- **Path following uses Mapbox's walking directions from the server.** One leg per request, legs up to 10 km, the token a function secret (`MAPBOX_DIRECTIONS_TOKEN`), separate from the app's map token; requests are counted per runner per day and no coordinates are logged. Paused, capped, no token, busy, no path or an error each give a straight leg and a note saying why. Whether Mapbox's terms allow keeping the returned lines in planned routes is to be confirmed before launch (`MANUAL_STEPS.md` B).
- **Offline maps:** a Mapbox offline pack 500 m around the route at zoom 12 to 16; the size shown before downloading is an estimate from the tile count (about 30 KB a tile plus the style), labelled "about".
- **The land preview** counts the cells whose centres are inside a planned loop at the season's grid resolution and compares them with the published map in view; it says the run itself decides.
- **Live links send little and keep it briefly.** The phone sends the newest fixes at most every `live_link_push_seconds` (30 s): at most ten, at least ten seconds apart, accuracy 50 m or better; with no signal it sends nothing and later sends only the newest. A link for one run carries that run only; it ends `live_link_grace_minutes` (15) after the run, at *Stop sharing* or after `live_link_max_hours` (6) at most. A standing link shows "isn't running right now" between runs. Positions are deleted `live_link_keep_hours` (24, never more) after sharing ends and at once when a link is turned off; ended one-run links are deleted after 30 days. New links are limited to 20 a day (`live_link` in the request limits).
- **The live page shows only** the runner's display name, whether they are running, paused or finished, the trail, where they are, when the last update came, time since the start (to the minute) and distance: no pace, health data, land or titles. It is not indexed by search engines, sends no referrer, and the app loads no analytics on public pages (`/l/…` and the shared-run pages `/a/…`). Blocked viewers and suspended or deleted accounts get nothing. *Open in maps* opens the shown position in Google Maps, on the viewer's tap.
- **The picture as the position dot** is made once on the phone from the profile picture (photo or drawn avatar) as a round image with a white border, kept in the app's files so it shows with no signal, and made again when the picture changes. Only the runner sees it, on the run map and the Map tab; *Show my picture as my position* (Settings → During runs, per phone) switches back to the dot.
- **Analytics:** new events `route_planned`, `route_offline` and `live_link` carry actions, buckets and flags only; `run_saved` gains `followed`, a bucket of off-route alerts and `marker`. No coordinates, route names or link tokens.
- **One pull request per stage.** Each stage's database changes, edge functions and app work go together in one pull request into `enhancements`; later stages are branched from the previous stage until it is merged.

## Running features, stage 2 (25 Nov)

Features 3 (training load, effort score and race predictions), 5 (run highlights), 12 (runners out right now) and 13 (live runs with friends) from the running-features plan (traced as RF3, RF5, RF12 and RF13). The stage's four open decisions were taken at the plan's recommendation, as the owner asked for all four stages without waiting; each is a setting or switch and changes without a release.

- **Runs with no heart rate and no effort rating count as moderate** (rating 5) and are marked as estimated, so a week's load isn't understated. The training screen says how many runs are estimated.
- **Everyone is counted in runners out right now unless they opt out** (Privacy → *Count me in runners out right now*). Only totals of at least `running_now_min_count` are shown, and the server never uses less than 5 whatever the setting says. No position is sent.
- **Live runs with friends are off until the runner turns them on**, then start with *Friends I choose*; *All my friends* is one tap away.
- **Friends can see each other while taking land**, before the publication delay. The setting says so in plain words, and each runner shows only themselves.
- **Training stays on the phone.** Effort is minutes in each heart-rate zone times the zone number when heart rate covers at least 60% of the run; otherwise minutes times the 1 to 10 rating, halved; otherwise the moderate estimate. The 6-week and 7-day loads are daily averages (`load += (effort − load) / N` with N = 42 and 7) and the balance is the first minus the second, shown after 21 days. A run's effort is compared with the median of the runner's efforts in the eight weeks before it (at least three runs): lighter below 0.8 times, harder above 1.25 times. Race predictions use Riegel's formula (exponent 1.06) from the best run of the last eight weeks that is long enough (3 km for 5K and 10K, 8 km for the half, 15 km for the marathon), shown as a range of ±3%. Imported runs from Apple Health or Health Connect count once (matched against the runner's own runs). Nothing here is uploaded; the back office can hide it all by adding `training` to the suspended health cards. Our own names (6-week load, 7-day load, balance), and "For training, not medical advice" on every training screen.
- **Highlights are fixed rules on the phone**, at most three lines, highest priority first: longest run this month, fastest 5 km since a month or in a number of months, land taken, gained or kept, a weekly streak, the weekly goal, a faster second half, "harder than usual for you", and a shoe milestone every 100 km (once shoes arrive in stage 4). A claim such as "since August" is made only when the runs loaded (120 days) cover it. A run's lines are worked out once and kept, so they don't change when the run is opened again; they are worked out once more when the land result arrives. A faster second half isn't repeated within three days unless the gap is bigger than last time, "harder than usual" appears at most once in three days, and the goal line at most once a day. The runner can hide them for a run. They go on a share card only when the runner adds them; the effort line never does, and the land line only once the result is published. Switch `run_summaries_enabled`.
- **Runners out right now counts profiles, not positions.** While a run records, the phone sends only the run's id when it starts, every five minutes (also from the background task), when it resumes and when it ends. The server counts the runner under the city and country on their profile (city names matched without case or extra spaces, as for the city ranking), drops a run that hasn't checked in for `running_now_stale_minutes` (15) or started more than 12 hours ago, and recounts every minute in `run_maintenance`; the app asks again every minute while the line is on screen. Check-ins are limited to 40 an hour (`running_now`), and the day's highest total is kept for 400 days for the back office. Switch `running_now_enabled`.
- **Friends are mutual follows**: both follows accepted, neither blocked, both accounts active, checked on every call. A runner shares only their own position, with the friends chosen (at most `friends_live_max_people`, 50) or all friends. Inside protected areas a friend's position is always hidden (there is no *show everywhere* for friends), and the card says they are in one of their protected areas. Friends see the last `friends_live_trail_minutes` (10) of the path, thinned to about 60 points. The Record tab reminds the runner before GO, with *Not this run*; sharing ends with the run, and turning sharing off ends a share in progress. Runs shared with friends are limited to 30 a day (`friends_live`). Switch `friends_live_enabled`.
- **One push serves every share.** Sharing with friends uses a live link of its own kind, which the public page refuses. The phone sends the newest fixes once (`live_push`, up to three links) and the server keeps them for each link, so a run shared by live link and with friends costs one request.
- **Analytics:** new events `training_viewed` (which part), `run_summary` (shown, shared or hidden, the number of lines and the top line's kind), `running_now` (shown, opened) and `friends_live` (turned on or off, a run shared, a friend's card opened, and all or chosen). No effort, load, prediction, heart rate, position or names; the payload test records everything sent while training, highlights, check-ins and friends sharing are used.

## Running features, stage 3 (25–26 Nov)

Features 4 (Bluetooth heart-rate straps) and 6 (maps of imported runs) from the running-features plan (traced as RF4 and RF6). Both add native code, so they reach phones only with the new Android app at the end. The stage had no open decision.

- **react-native-ble-manager, not react-native-ble-plx.** The plan asked for the library to be checked against this React Native version first. React Native 0.88 runs only the New Architecture; react-native-ble-plx 3.5.1 is still an old-style module (no TurboModule spec) and would depend on the compatibility layer, while react-native-ble-manager 13.0.2 is a TurboModule written for the New Architecture, with its own config plugin. The plan named it as the fallback. Only the standard Heart Rate Service is scanned for, so other Bluetooth devices nearby are never listed or touched.
- **Permissions:** on Android 12 and later *Nearby devices* (`BLUETOOTH_SCAN`, declared as never used for location, and `BLUETOOTH_CONNECT`); on Android 9 to 11 the older Bluetooth permissions and the location access the app already asks for to record runs. iPhone gets the Bluetooth usage text and background Bluetooth (`bluetooth-central`) for runs with the screen off.
- **A strap's readings are the app's own heart rate.** They go into the phone's health cache, beside Apple Health and Health Connect data, as the `self` source: at most one a second, written every 15 seconds and when the run ends. Wherever heart rate is read, other sources' readings within 15 seconds of a strap reading are left out, so for the same minutes a strap beats a watch and nothing is counted twice; where the strap has a gap, a watch's readings still count. Readings are kept as long as the cache keeps health data, never uploaded and never sent to analytics. Discarding a run deletes the strap readings taken during it.
- **During a run** the phone connects to the paired strap by itself when the run starts (and again when the app is reopened during a run), shows heart rate and zone in the recorder, and after a drop says so and tries again every 5 seconds; the run carries on either way. The pairing (the strap's Bluetooth id, the name it advertises, the battery level last read) is kept on the phone only; Settings → Sensors appears only in app builds that include Bluetooth. Switch `ble_sensors_enabled`.
- **Maps of imported runs read a route only when the runner asks.** *Show maps for imported runs* (Health connections, Android) turns them on, and an imported run now has its own page, with *Show map*. Health Connect hands over a route another app recorded only after the runner agrees in Android's own dialog, once per route, so routes are never read in a background sync. The library in use (react-native-health-connect 4.1.3) can't ask for the all-routes permission itself; the app declares it (`READ_EXERCISE_ROUTES`) so Health Connect's settings can grant it, which removes the per-route question. Points are kept in the health cache with the run and deleted when maps are turned off, the health app is disconnected, imported data is cleared, or the cache's retention ends. A run saved without a route says so. Imported runs still never earn land, titles, points or challenges, and their maps can't be shared. Apple Health routes wait for the iPhone app. The back office hides all of it with the health card id `imported_routes`.
- **Analytics:** `sensor` (paired, forgotten, connection failed, dropped, reconnected), `imported_map` (turned on or off, shown, permission declined, no route) and `run_saved.hr_source` (none, health app, strap; AirPods come with the iPhone app). No strap names or ids (names can hold serial numbers), heart rates, points or places; the payload test records everything sent while a strap streams and an imported route is shown.

