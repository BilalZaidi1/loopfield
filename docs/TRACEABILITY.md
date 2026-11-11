# Requirements traceability

Maps every functional requirement (PRD v1.2 §8, FR01–FR54) and every screen or panel definition (Appendix D, 01–49) to the code that implements it and the automated checks that exercise it. Status values:

* **Tested** — automated tests exercise the acceptance evidence (see `docs/VERIFICATION.md` for the run).
* **Implemented** — code complete and type-checked, but the acceptance evidence needs a device, field or hosted-service test that has not been run.
* **Partial** — some of the acceptance evidence is not met yet; the gap is named.

Test locations: `core` = `packages/core/test/*.test.ts` (vitest), `sql` = `supabase/tests/sql/*.sql` (pgTAP), `worker` = `services/worker/test/*.test.ts` (vitest against Postgres), `jest` = `apps/mobile/__tests__`, `edge` = `scripts/smoke-functions.mjs` (Deno). Quoted names are test names.

Path shorthands: `core/` = `packages/core/src/`, `mig/` = `supabase/migrations/2026110400`, `jobs/` and `api/` = `supabase/functions/_shared/jobs|api/`, `app/` = `apps/mobile/app/(app)/`, `src/` = `apps/mobile/src/`.

## Recording and account (FR01–FR09)

| ID | Pri | Requirement | Implementation | Automated evidence | Status |
|---|---|---|---|---|---|
| FR01 | P0 | Account and versioned consent | `mig/0100` consents ledger, `set_consent` (`mig/0900`), column privileges (`mig/0600`); `(auth)/sign-up.tsx` (18+, terms), `(onboarding)/profile-setup.tsx`, `(onboarding)/permissions.tsx`; versions in `src/config/env.ts` | sql 01 "contest sharing is off until explicitly enabled (FR01)", "consent version and timestamp are stored", "contest consent flags only change through set_consent" | Tested |
| FR02 | P0 | Location requested at point of use | `(onboarding)/permissions.tsx`, `(tabs)/record.tsx` (denied / approximate / services off / revoked states), `src/recording/recorder.ts` | none (OS permission flows) | Implemented — device test pending |
| FR03 | P0 | Start and finish one run across foreground, lock screen, reconnect, retry | `src/recording/recorder.ts`, `task.ts` (background location task), `db.ts` (SQLite), `uploader.ts`; `api/upload.ts` | jest "uploads digest-verified chunks, finalizes…"; worker "is idempotent for repeated chunk and finalize requests" | Implemented — lock-screen behaviour needs devices |
| FR04 | P0 | Persist recording locally; restore without duplicated distance | `src/recording/db.ts` (committed samples + state), recovery in `src/state/services.ts` → `run/active.tsx`; distance from `core/recording/summary.ts` | core "does not accumulate distance across a long gap"; worker idempotent finalize | Implemented — process-kill restore needs devices |
| FR05 | P0 | Record while locked; disclose limits | `app.config.ts` (iOS `location` background mode, Android foreground service), `src/recording/task.ts`; disclosure text in `(tabs)/record.tsx` and `help.tsx` | prebuild manifest inspection (VERIFICATION §Mobile) | Implemented — field matrix (PRD §18) not run |
| FR06 | P0 | Offline upload queue, exactly once in effect | `src/recording/uploader.ts` (digest-verified chunks, retry with backoff, local copy kept until receipt), `api/upload.ts` (idempotent chunk/finalize) | jest "keeps evidence and schedules a retry when offline", "marks permanent server rejections without deleting the local copy"; worker "is idempotent…" | Tested |
| FR07 | P0 | Gaps stay gaps; no reconstruction | `core/recording/summary.ts`, `core/territory/loop.ts`; gap banner in `activities/[id].tsx` | core "does not accumulate distance across a long gap", "rejects an open loop instead of bridging the gap", "withholds the result when GPS evidence has a gap longer than ten seconds" | Tested |
| FR08 | P1 | Fitness history that agrees after reconciliation | `jobs/competition.ts` `reconcileActivity` (server summary replaces device preview), `activities/index.tsx`, `activities/[id].tsx`, `src/features/results/useActivities.ts` | core "produces kilometre splits that sum to the distance"; worker pipeline receipt + reconciliation | Tested (server side); UI agreement by inspection |
| FR09 | P1 | Export own activity data | `request_data_export` (`mig/0900`), `jobs/account.ts` `exportData`, `account` function (5-minute signed URL), `settings/account.tsx` | worker "exports only the requester’s own records and never another runner’s route" | Tested |

## Competition (FR10–FR19)

| ID | Pri | Requirement | Implementation | Automated evidence | Status |
|---|---|---|---|---|---|
| FR10 | P0 | Versioned speed routes; consent and review before publication | `propose_route` (`mig/0900`, publication consent), `jobs/competition.ts` `buildRouteProposal`, `ops_review_route` (`mig/1000`), immutable `course_versions` trigger (`mig/0200`); `propose-route/[activityId].tsx`, `ops/routes.tsx` | worker "speed titles are independent of land (FR31)…" (proposal → pending review → reviewer approval → course version); core "detects materially duplicate routes in the same direction only" | Tested |
| FR11 | P0 | Separate private, territory and speed modes with separate consent | session tickets (`core/tickets.ts`, `api/sessions.ts`), mode picker in `(tabs)/record.tsx` | worker "refuses competitive tickets without explicit consent", "speed titles are independent of land"; sql 03 "title changes never transfer land" | Tested |
| FR12 | P0 | Validate land and title independently | `core/territory/loop.ts`, `core/speed/match.ts`, `jobs/competition.ts` (`evaluateLoopJob`, `evaluateAttemptJob`) | core loop suite (open loop, figure eight, gap, mock location) and speed suite (wrong direction, shortcut, sparse gates) | Tested |
| FR13 | P0 | Deterministic cell control | `core/territory/ledger.ts`; `internal.apply_claim`, `recompute_cells`, `replay_season` (`mig/0700`) | core "decides by verified completion order, not upload order", "breaks exact completion-time ties deterministically"; sql 02 "replay reproduces identical control"; worker "serializes concurrent overlapping claims deterministically (FR13, FR15)" | Tested |
| FR14 | P0 | Speed title margin | `core/speed/titles.ts`, `internal.compute_title` (`mig/0800`) | core "needs 10:53.4 or faster to beat an 11:00 benchmark", "keeps the champion on a near tie…"; sql 03 "route detail exposes the time needed (650 s - 6.5 s margin)" | Tested |
| FR15 | P0 | No race conditions | partition advisory locks `internal.lock_partitions` (`mig/0700`), separate atomic title record (`mig/0800`), `SKIP LOCKED` job queue (`mig/0400`) | worker "serializes concurrent overlapping claims…"; sql 05 "claimed job is not handed to a second worker" | Tested |
| FR16 | P0 | Correct only affected results | `delete_activity` (`mig/0900`), `jobs/account.ts` `deleteActivity`, `internal.invalidate_claim` / `invalidate_attempt` replays | sql 02 "overlap reverts to A", "B controls nothing after invalidation"; sql 05 "deleting the run withdraws the shared summary", "dependent claim/attempt replay is queued" | Tested |
| FR17 | P0 | Late uploads and seasons | season pinning on tickets, `internal.maintain_seasons`, `replay_season` (`mig/0700`) | worker "keeps late uploads in personal history only"; sql 02 "late earlier loop leaves the 10 overlap cells unchanged"; core "rejects intervals that start before issue or after the start window" | Tested |
| FR18 | P1 | Explain land and title results separately | `activity_detail` RPC, `src/features/results/ResultCards.tsx` (`LandCard`, `TitleCards`), `run/summary/[id].tsx`, `territory/[cell].tsx` | sql 02 "displayed claim area is the awarded cell area, not the raw polygon" | Implemented (UI by inspection) |
| FR19 | P1 | Private exploration survives losses | `internal.record_exploration` / `remove_exploration` (`mig/0700`), `exploration.tsx` | worker "survives losing the claimed land and is withdrawn only when its source run is deleted" | Tested |

## Community privacy and operations (FR20–FR28)

| ID | Pri | Requirement | Implementation | Automated evidence | Status |
|---|---|---|---|---|---|
| FR20 | P1 | Join a private club room | `invite_to_club`, `respond_club_invite`, `remove_club_member` (`mig/0900`), `authz.can_view_club` (`mig/0500`); `club/[id]/index.tsx`, `club-invite/[token].tsx` | sql 04 "member accepts invitation", "removed member loses the private feed", "removed member cannot fetch club posts by id" | Tested |
| FR21 | P0 | Limit public disclosure | 30-minute publication delay (`internal.publish_due_territory`, `publish_due_titles`), published vs authoritative tables; no raw traces or start markers in public RPCs | sql 02 "a run is not published before the 30-minute delay"; sql 03 "published state waits for the publication delay" | Tested |
| FR22 | P0 | Block and report | `block_user`, `submit_report` (`mig/0900`), chat freeze job `syncBlock`; disclosure text in `settings/privacy.tsx`, `profile/[id].tsx` | sql 04 "blocked user cannot follow", "block enqueues a server-side chat freeze"; core "enforces audiences and blocks"; worker Stream suite | Tested |
| FR23 | P0 | Delete an account | `request_account_deletion` (`mig/0900`), `jobs/account.ts` `deleteAccount` (checkpointed steps), device clear in `src/state/session.tsx` + `src/health/sync.ts` | worker "withdraws land, removes identity and deletes the auth user"; sql 05 "profile marked deleted and hidden at once; the job removes the rest" | Tested (server); device cache clear by inspection |
| FR24 | P0 | Operate land and speed contests | `mig/1000` ops RPCs (holds, integrity cases, route review, exclusions, region review, kill switches, replays, roles) with audit; `app/ops/*` | sql 05 "non-staff cannot open the moderation queue", "non-staff cannot flip kill switches", "a moderator has no scoring powers", "moderation action is audited" | Tested |
| FR25 | P1 | Notification controls | `notification_prefs` (`mig/0300`), `core/notifications/policy.ts`, `jobs/social.ts` `pushPending`, `dispatchDigests`; `settings/notifications.tsx` | core "applies quiet hours in the user’s time zone, across midnight" | Tested (policy); cross-time-zone digest delivery by code path |
| FR26 | P1 | Accessible status | `src/lib/cues.ts` (visual text always, haptics optional, speech opt-in), map list alternative (`summarizeCells`), patterns + labels on ownership | jest "always delivers the visual text, haptics by preference…", "summarizes the view for the accessible text alternative" | Tested (logic); screen-reader pass pending |
| FR27 | P0 | Enforce access control | RLS on every public table (`mig/0600`, `mig/1400`), closed `internal` schema, grants (`mig/1200`), storage policies (`mig/1100`) | sql 01 "all public tables have RLS enabled", "clients cannot write loop claims", "clients cannot write entitlements", "internal schema is closed to clients", "clients cannot change account status" | Tested |
| FR28 | **P2** | Sell subscriptions correctly | see [P2](#p2-kept-separate) | | Built, disabled by config |

## Free-form geometry and independent titles (FR29–FR36)

| ID | Pri | Requirement | Implementation | Automated evidence | Status |
|---|---|---|---|---|---|
| FR29 | P0 | Detect eligible closed loops | `core/territory/loop.ts`, `internal.evaluate_claim_geometry` (`mig/0700`) | core "territory loop validation (FR29, Appendix A)" suite; sql 02 "A loop is eligible" | Tested |
| FR30 | P0 | Resolve partial overlaps | `core/territory/ledger.ts`, `internal.apply_claim` | core "transfers only the overlapping cells to a later loop (partial takeover)"; sql 02 "A keeps only the non-overlapping 90 cells…" | Tested |
| FR31 | P0 | Titles independent of land | separate claim and title ledgers (`mig/0700`, `mig/0800`) | worker "speed titles are independent of land (FR31)…"; sql 03 "title changes never transfer land" | Tested |
| FR32 | P0 | Stable cell and area rules | versioned grid and band in `core/rules/config.ts`, frozen cell sets, exclusions (`internal.apply_exclusion`) | sql 02 "frozen cell set has exactly the 100 fully contained cells", "excluded cells are not awarded", "unavailable eligibility data never authorizes a claim", "A ranks first by published area" | Tested |
| FR33 | P1 | User route proposals | `propose_route`, `withdraw_route_proposal` (`mig/0900`), `buildRouteProposal`, `proposals.tsx` | worker proposal flow; core duplicate detection | Tested (submit, duplicate); withdrawal by code path |
| FR34 | P0 | Protected areas withhold whole claims | `protected_areas` + `internal.protected_area_geom` (`mig/0100`), check in `evaluate_claim_geometry`; `settings/privacy.tsx` | sql 02 "protected area withholds the shared claim", "no clipped outline is stored for a withheld claim" | Tested |
| FR35 | P0 | Membership stays voluntary | no code path links territory to club membership; club joins only through explicit RPCs | sql 04 (membership only via invite/join RPCs); review of `mig/0700` | Implemented — no dedicated negative test |
| FR36 | P1 | Independent rankings | `territory_leaderboard` (`mig/0700`), `speed_route_detail` (`mig/0800`); `leaderboard.tsx`, `club/[id]/rankings.tsx` | sql 02 "A ranks first by published area"; sql 03 "C (650 s) beats the 660 s benchmark regardless of arrival order" | Tested |

## Social and community (FR37–FR45)

| ID | Pri | Requirement | Implementation | Automated evidence | Status |
|---|---|---|---|---|---|
| FR37 | P1 | Profiles and following | `follow`, `respond_follow_request`, `remove_follower`, `unfollow`, `mute_user`, `block_user` (`mig/0900`); `connections.tsx`, `profile/[id].tsx` | sql 04 "following a private profile creates a request", "author approves the request"; core social policy matrix | Tested |
| FR38 | P1 | Following and Discover feeds | `feed_following`, `feed_discover` (keyset pagination) (`mig/0900`); `(tabs)/home.tsx`, `discover.tsx` | sql 04 "following feed returns exactly the authorized posts", "private club is invisible to non-members…", "stranger sees only the public post" | Tested |
| FR39 | P1 | Text and photo posts | `create_post` → upload slots → `finalize_post_media` → `processPostMedia` (EXIF/XMP stripped, derivatives only); `compose.tsx`, `src/features/social/publish.ts` | core "removes EXIF/XMP and comments but keeps image data"; worker "publishes processed derivatives only" | Tested |
| FR40 | P1 | Reactions, comments, mentions | `toggle_reaction`, `add_comment`, mention parsing (`core/social/policy.ts`) | sql 04 "reaction is reversible", "cannot comment on an unauthorized post", "mention does not grant access…" | Tested |
| FR41 | P1 | Consent-based direct messages | `messaging_eligibility`, `chat` function (server-side channel creation, expiring tokens), Stream channel type (`_shared/stream.ts`, `scripts/setup-stream.ts`); `inbox/*` | sql 04 "no messaging without mutual follow (default)", "mutual followers may message"; worker "requires mutual follows by default and creates channels only server-side" | Tested (backend); Stream dashboard config pending |
| FR42 | P1 | Clubs and local communities | `create_club`, `join_club`, `leave_club`, roles (`mig/0900`); `club/*` | sql 04 "organizer removes the member", "removed member loses media object access" | Tested |
| FR43 | P0 | Revoke audience access everywhere | `authz.can_view_post*`, `authz.can_view_media_object` in storage policies (`mig/1100`); `deletePostMedia` job | sql 04 "removed member loses the private feed", "removed member loses media object access", "removed member cannot fetch club posts by id"; sql 05 "deleting the run withdraws the shared summary" | Tested |
| FR44 | P0 | Moderate social content | `submit_report`, `ops_moderate`, `ops_decide_content_appeal` (`mig/1000`); `report.tsx`, `appeals.tsx`, `ops/moderation*` | sql 05 "moderator sees the open case", "moderator removes the post", "moderation action is audited"; worker Stream report path | Tested |
| FR45 | P0 | Minimise notification disclosures | `core/notifications/policy.ts` `safePushPreview`; Stream push disabled per channel type; single backend push path (`stream-webhook` → `internal.notify`) | core "never includes message text in previews"; worker Stream suite; edge "signed non-message event is acknowledged without action" | Tested |

## Health analytics (FR46–FR54)

All health data stays on the device (`src/health/*`, SQLite cache excluded from backup). No health table exists in the backend.

| ID | Pri | Requirement | Implementation | Automated evidence | Status |
|---|---|---|---|---|---|
| FR46 | P0 | Granular health access | per-card permission requests in `src/health/healthkit.ts`, `healthconnect.ts`; `health/connections.tsx` | none (platform permission dialogs) | Implemented — device test pending |
| FR47 | P1 | Private health dashboard | `health/index.tsx`, `health/metric/[type].tsx`, `goals.tsx`, `src/features/health/metrics.ts` | jest "leaves days without readings absent rather than zero"; charts "marks missing days as no data (never zero)…" | Tested (logic) |
| FR48 | P0 | Source, units and coverage | `core/health/units.ts`, `metrics.ts`; method tags (SDNN, RMSSD, VO2 method) | core "keeps SDNN and RMSSD as separate series", "returns the latest VO2 max estimate per source with its method", "normalises energy and distance units…"; jest "keeps HRV methods separate…" | Tested |
| FR49 | P1 | Heart-rate zones and trends | `core/health/metrics.ts` zones (basis + version), `health/zones.tsx` | core "counts time in zone only over covered intervals and versions the zone basis", "treats missing days as missing and refuses comparisons with poor coverage" | Tested |
| FR50 | P0 | Reconcile imports without duplication | `core/health/reconcile.ts`; anchored queries / change tokens in `healthkit.ts`, `healthconnect.ts` | core "workout reconciliation (FR50, Appendix A)" suite, "never sums phone and watch steps for the same hour" | Tested |
| FR51 | P0 | Disconnect and clear | `disconnectHealth`, `clearHealthData` (`src/health/sync.ts`), `clearHealthCache` (`cache.ts`); cleared on sign-out (`src/state/session.tsx`) | none automated (native modules) | Implemented — device test pending |
| FR52 | P0 | Isolate health from social and contests | analytics allowlist (`core/analytics/events.ts`), share fields copied server-side only (`create_post`), imports never create tickets | core "never accepts health readings for health_viewed", "drops unknown, sensitive and malformed properties", "keeps a separate non-overlapping imported workout as personal history only" | Tested |
| FR53 | P1 | Export own workouts to health stores | `src/health/export.ts` (separate write consent; `HKExternalUUID` / `clientRecordId` = `loopfield:<id>` so retries update one record) | core "links this app’s own exported workout to the first-party run instead of re-importing it" | Partial — native write path needs devices |
| FR54 | P1 | Usable cross-platform health views | limited-history, no-data, stale-cache (`STALE_AFTER_MS`) and revoked states in `health/*`; numeric tables in `src/components/charts.tsx` | jest charts "…offers a numeric table"; health-metrics | Implemented — device matrix pending |

## P2 kept separate

| ID | Pri | Requirement | Implementation | Automated evidence | Status |
|---|---|---|---|---|---|
| FR28 | P2 | Sell subscriptions correctly | `src/billing/purchases.ts`, `settings/subscription.tsx`; `revenuecat-webhook` (Authorization header), `billing-sync`, `jobs/billing.ts` REST reconciliation; `public.entitlements` written by the service role only. `app_config.paywall_enabled = false`: free pilot, nothing core is gated | core "ignores duplicate/older events…", "keeps access during a billing grace period then expires", "revokes immediately on refund…"; worker "applies purchases once…", "never grants entitlements to anonymous RevenueCat ids"; edge RevenueCat checks | Tested (backend); store sandbox not run |

## Screens and panels (Appendix D)

Every screen has loading (skeletons), empty, error/retry and offline states through the shared components in `src/components/ui.tsx` (`LoadingState`, `Skeleton`, `EmptyState`, `ErrorState`, `Banner`, `OfflineBanner`) and real data only. Paths are relative to `apps/mobile/app/`.

| # | Screen or panel | Route file | Notes |
|---|---|---|---|
| 01 | Welcome | `(auth)/welcome.tsx` | Get started / Log in pinned on screen; illustrated explainer |
| 02 | Create account | `(auth)/sign-up.tsx` | 18+ confirmation, terms, verification email |
| 03 | Log in and recovery | `(auth)/sign-in.tsx`, `auth/reset-password.tsx`, `auth/callback.tsx` | PKCE deep link; Apple/Google buttons only for providers enabled in Supabase (`src/features/auth/`) |
| 04 | Profile setup | `(onboarding)/profile-setup.tsx` | `src/features/profile/ProfileForm.tsx` |
| 05 | Permissions setup | `(onboarding)/permissions.tsx` | location, background, notifications; health later |
| 06 | Home feed | `(app)/(tabs)/home.tsx` | Dashboard first (this week, your ground, season leaders, people you follow), then Following / Discover, composer, inbox, notifications (`src/components/TopBar.tsx`) |
| 07 | Discover runners and communities | `(app)/discover.tsx` | opted-in profiles, public clubs |
| 08 | Post composer | `(app)/compose.tsx` | photos with alt text, attachments, audience preview |
| 09 | Post detail and comments | `(app)/post/[id].tsx` | |
| 10 | Connections | `(app)/connections.tsx` | |
| 11 | Inbox | `(app)/inbox/index.tsx` | |
| 12 | Conversation | `(app)/inbox/[channel].tsx` | send status, mute, block, report, delete |
| 13 | Notifications | `(app)/notifications.tsx` | |
| 14 | Territory map | `(app)/(tabs)/map.tsx` | full-bleed map, floating controls, bottom sheet with text summary (list alternative), cell and route panels, map key, season, Start Run |
| 15 | Territory detail | `(app)/territory/[cell].tsx` | |
| 16 | Speed routes | `(app)/routes/index.tsx` | |
| 17 | Speed route detail | `(app)/routes/[id].tsx` | time needed incl. margin |
| 18 | Private exploration | `(app)/exploration.tsx` | |
| 19 | Territory leaderboard | `(app)/leaderboard.tsx` | |
| 20 | Pre-run | `(app)/(tabs)/record.tsx` | modes, GPS status, consent |
| 21 | Active recording | `(app)/run/active.tsx` | cues with visual text |
| 22 | Run summary | `(app)/run/summary/[id].tsx` | separate land and title cards |
| 23 | Activity history | `(app)/activities/index.tsx` | first-party runs and marked imports |
| 24 | Activity detail | `(app)/activities/[id].tsx` | |
| 25 | Share preview | `(app)/share/[id].tsx` | basic fields only, no biometrics |
| 26 | Propose speed route | `(app)/propose-route/[activityId].tsx` | publication consent |
| 27 | My route proposals | `(app)/proposals.tsx` | |
| 28 | Clubs and communities | `(app)/(tabs)/clubs.tsx`, `(app)/club/create.tsx` | |
| 29 | Invitation or join request | `(app)/club/[id]/index.tsx` (join panel), `(app)/club-invite/[token].tsx` | |
| 30 | Club or community home | `(app)/club/[id]/index.tsx` | |
| 31 | Members and roles | `(app)/club/[id]/members.tsx` | |
| 32 | Group rankings | `(app)/club/[id]/rankings.tsx` | territory and route views separate |
| 33 | Organizer controls | `(app)/club/[id]/organizer.tsx` | |
| 34 | Other runner profile | `(app)/profile/[id].tsx` | |
| 35 | My profile | `(app)/me.tsx`, `(app)/settings/profile.tsx` | |
| 36 | Progress overview | `(app)/(tabs)/progress.tsx` | |
| 37 | Health dashboard | `(app)/health/index.tsx` | |
| 38 | Metric detail | `(app)/health/metric/[type].tsx` | |
| 39 | Heart rate zones | `(app)/health/zones.tsx` | |
| 40 | Health connections | `(app)/health/connections.tsx` | |
| 41 | Goals and trends | `(app)/goals.tsx` | |
| 42 | Season history | `(app)/seasons.tsx` | |
| 43 | Settings | `(app)/settings/index.tsx` | |
| 44 | Privacy and protected areas | `(app)/settings/privacy.tsx` | |
| 45 | Notification preferences | `(app)/settings/notifications.tsx` | |
| 46 | Help and game rules | `(app)/help.tsx` | |
| 47 | Report a problem | `(app)/report.tsx` | |
| 48 | Appeal and request status | `(app)/appeals.tsx` | |
| 49 | Account and data controls | `(app)/settings/account.tsx` | export, deletion, health cache clearing |

Additional screens outside Appendix D: first-run tour (`(app)/tour.tsx`, replayable from Help and Settings), subscription (`settings/subscription.tsx`, P2), club creation, operator tools (`ops/index.tsx`, `ops/moderation*.tsx`, `ops/routes.tsx`, `ops/integrity*.tsx`, `ops/system.tsx`; PRD §16), and, from 11 Nov, movement points (`(app)/points.tsx`), challenges and badges (`(app)/achievements/index.tsx`) and the global ranking (`(app)/achievements/ranking.tsx`).

Every database call made by these screens is checked against the schema by `scripts/check-client-queries.mjs` (33 select strings, 120 of 122 RPC calls; the remaining two pass a typed object).

## Added after PRD v1.2: movement points, reclaiming, challenges and ranking (11 Nov)

Requested on 6 Nov; not in the PRD, so there are no FR numbers. IDs below are local. Values are proposed defaults in `app_config` (see `DECISIONS.md`, "Movement points, reclaiming and achievements").

| ID | Requirement | Implementation | Automated evidence | Status |
|---|---|---|---|---|
| MP1 | Points from the verified distance of every verified run, public or private; private runs earn points but expose nothing and capture nothing | core `evaluateMovement`, `pointsForDistance`; `jobs/competition.ts` `awardMovement` after each run is reconciled (and a one-off backfill job); `internal.award_movement_points` (one ledger row per run, 400 a UTC day); `internal.movement_ledger`, `internal.movement_balances` (no client access) | core movement tests; pgTAP 06 "a verified 2.549 km run earns 25 points…", "the daily cap…", "the points ledger is closed to clients", "another runner sees only their own balance"; worker "a private run (no ticket, no contest) earns points from its server-verified distance" | Tested (backend). Real runs on devices pending |
| MP2 | Resist spoofing, duplicate rewards and manipulation | mocked locations void the run; no bridging across gaps or pauses; GPS jumps and vehicle-speed stretches left out; under 200 m earns nothing; idempotent award; revoke on deletion or invalidation, reinstate on appeal (`loop_claims_status_change` trigger, `account.ts`); runs never evaluated are re-queued by the minute sweep (`internal.enqueue_missing_movement`, at most three jobs per run) | core; pgTAP 06 "awarding the same run again changes nothing", "removing a run takes its points back", "an overturned removal restores the points", "a processed run whose points were never evaluated gets a points job"; worker "mocked locations earn nothing, and deleting a run takes its points back" | Tested. Thresholds proposed |
| MP3 | Show the balance on the profile and the map | map points pill and panel row, `points.tsx` (balance, today against the cap, how points work, history), profile tile, Home next-badge card, `RunPointsCard` on run summary and activity detail | jest receipt; visual check 11 Nov | Implemented |
| RC1 | Lost cells stay identifiable on the owner's map | `public.my_lost_cells` (viewport or whole season), `internal.held_basis`; `lostToFeatures` and the `lost` layers in `MapCanvas.tsx` (dashed outline in your colour, faded when not reclaimable, selection casing); map callout, key entries, cell panel and the “This was yours” card in `territory/[cell].tsx` | pgTAP 06 "A sees exactly the 4 cells B took", "the viewport form returns the same cells"; jest "marks lost cells as reclaimable or not, and selected" | Tested (data). Native layer not yet seen on a device |
| RC2 | Tap lost cells, single or multi-select; show cost per cell, total, balance and what remains; confirm returns the cells and deducts the points | map reclaim mode (tap to toggle), `ReclaimSheet` list flow (grouped by who took the cells and when, select all), `ReclaimReceipt`, confirmation dialog, `ReclaimDone`; `public.reclaim_cells` | pgTAP 06 "two cells reclaimed", "for 6 points", "balance drops by exactly the cost", "A controls the cell again", "the published map shows it at once"; worker "returns cells the runner held, charges the exact cost once, and blocks points ping-pong"; jest receipt | Tested |
| RC3 | Only previously owned cells; points never buy new territory; no duplicate claims or inconsistent ownership; changes reflected on the map and stats | eligibility re-checked per cell inside one transaction under `internal.lock_movement` then `internal.lock_partitions`; reclaims are one-cell claims (`source = 'reclaim'`) applied by `apply_claim`, so replay and newest-wins still hold; `internal.reclaim_requests` (request ids), 30 an hour, 200 cells; cells taken back with points can only be won back by running; refunds and withdrawals on invalidation; queries invalidated after success | pgTAP 06 "points cannot buy ground the runner never held", "repeating a request returns its first result", "another runner cannot reuse a request id", "replay reproduces control including reclaimed cells", "points cannot undo a reclaim", "a later loop takes a reclaimed cell", refund and withdrawal assertions; worker idempotency | Tested |
| RC4 | Costs balanced so running stays primary | cost = area / 1,000 m², rounded up: 3 points a resolution-11 cell; 10 points a km | core "prices a cell by its area…", "keeps running far cheaper than points…" | Proposed values |
| AC1 | Challenges in six categories with objectives, progress, completion criteria and tiered badges, awarded automatically | `public.challenges` (24), `internal.user_challenges`, `internal.evaluate_achievements` with dirty-marking triggers and the minute sweep; `my_challenges`, `refresh_my_achievements`; `badge_earned` notification | pgTAP 06 "A earned the 50 km badge…", "each new badge is notified once", "a badge whose evidence was invalidated is removed", "all 24 challenges are listed with my progress" | Tested |
| AC2 | Badges on profiles and in an achievements section | `achievements/index.tsx` (challenges and badges tabs, category filter, detail sheet), `BadgeMedal`, `BadgeStrip`, own profile and other profiles (`achievement_profile`, visibility rules) | jest medal and strip tests; visual check 11 Nov | Implemented |
| AC3 | Global ranking from challenges and achievements (not points), transparent, with regional, country, friends and club filters | `internal.achievement_scores`, `public.achievement_leaderboard(scope, club)`, `regions.country_code`, `internal.can_see_achievements`; `achievements/ranking.tsx`, `RankingExplainer` (the published formula and your breakdown) | pgTAP 06 "score = tier points + 25 per category", "points balance never changes the ranking score", scope and privacy assertions; jest explainer | Tested |
| UI1 | Onboarding buttons aligned and uniform; map counts that fit; richer number tables | `Button` (equal side slots), `tour.tsx`, sign-in and sign-up; map `Scoreboard`; `ChartTable` in `charts.tsx` (Home, Progress, Goals, Zones, health metrics) | jest "reserves an equal slot…", "names each period in full…" | Implemented |

## Added after PRD v1.2: enhancement request (11 Nov)

Requested on 11 Nov as a 15-section brief; not in the PRD, so IDs are local. Choices the owner made: recommended route privacy with time shown and heart rate only on an exported image; a separate season race next to a permanent map; a step counter for the bike check; a new build. Values are proposed defaults (see `DECISIONS.md`, "Enhancement release").

| ID | Brief section | Implementation | Automated evidence | Status |
|---|---|---|---|---|
| EN1 | 1 Dynamic run map | `RunMap.tsx` (Mapbox viewport follows the puck; pan hands the camera over; recenter and 15 s auto-resume; 3D perspective, course-up, buildings), `run/active.tsx` full-screen layout with floating status and collapsible stats; explore map 3D toggle | type check, lint; no map is drawable in a browser or Expo Go | Implemented. **Not seen on a device** |
| EN2 | 2 Avatars on the territory map | `features/avatar` (original cartoon parts, builder, saved as an image in the runner's folder), `ProfileForm` (photo, cartoon, back to photo); `territory_owners_in_view`; `owners.ts` (anchor on own land, screen-space grouping), `AvatarPin` in Mapbox `MarkerView` (min zoom 13, collision), `OwnerCard`; profile parts validated and pictures confined to the owner's folder | pgTAP 11 (10): part and path validation, owners in view with rank, blocked runners anonymous, signed-out refused; jest avatars (7): fallback parsing, seeded shuffle, headscarf and sunglasses layering, safe SVG, anchors on L-shaped land, grouping by zoom; web visual check of the builder and pins | Implemented. Native pins **not seen on a device** |
| EN3 | 3 Anti-cheat and suspicious speed | core `integrity/speed.ts` (record envelope, spike filter, smoothing, live checks, step cadence), `recording/integrity.ts` (warnings, auto-pause, background task), server holds and flags (`flag_activity`, integrity cases, appeals, credit back) | core integrity (13 tests); worker integrity (3); pgTAP 07 movement-integrity block (flags, single case, appeal, reviewer clearing and credit) | Tested. Thresholds proposed; step sensor **not tested on a device** |
| EN4 | 4 Feed activity cards | `post_row_json` shared route and land, `RunMapPreview` in `PostCard`, `post/route/[id].tsx` interactive map | pgTAP 08 (16); jest share (9) | Tested |
| EN5 | 5 Permanent map vs seasons vs events | derived claims per layer (`derive_layer_claims`), permanent competition per region, event and club races, `finish_events`, cascades, `resolveCompetitions`, layer picker, events screens, standings | pgTAP 07 layers and events block; worker layers (3); jest layers (10) | Tested |
| EN6 | 6 Communities vs groups | `clubs.kind`, group cap, group chat (`loopfield_group`, `sync_group_chat`), separate creation flows and tabs | pgTAP 09; worker groups (3); jest clubs (7) | Tested. Stream **not configured**, so group chat untested against Stream |
| EN7 | 7 Branding | `club-media` bucket and policies, `set_club_branding`, `ClubLogo`, `ClubCover`, artworks, preview before saving; logos on lists, posts, events, profile | pgTAP 09 branding block; jest clubs | Tested |
| EN8 | 8 Ownership management | offers with acceptance, owner-only admin roles, removal rules, owners hand over before leaving, deferred succession, deletion after typing the name (`delete_club`, `archive_club`, `close_club` job); Manage screen | pgTAP 09 (24); worker groups; jest clubs | Tested |
| EN9 | 9 Social sharing | share cards 9:16, 4:5, 1:1 (`ShareCard`, `exportCard`), save and system share, QR and public page `/a/<token>`, revocable links, on-device heart rate | pgTAP 08; jest share; web visual check | Implemented. Instagram Stories direct share and video **not built** |
| EN10 | 10 UI consistency | edge-to-edge card rails (Android last-card spacing), `ActionBar` after runs, stacked buttons replaced (run summary, health connections), equal button slots | jest (redesign suites) | Implemented. Android spacing **not seen on a device** |
| EN11 | 11 Resend emails | `email.ts` (branded templates, security notices), `email_outbox` and `enqueue_email`, `jobs/email.ts` (send job: preferences, suppressions, failure handling), triggers for each email, `email` function (one-click unsubscribe), `/unsubscribe` page | pgTAP 10 email block; worker email (10); Deno smoke (4 new checks); rendered and screenshotted at phone and desktop widths, light and dark | Tested with a fake sender. **No email sent**: Resend has no verified domain (A5) |
| EN12 | 12 In-app notifications | land items after publication, contested land, friends' runs, new members, announcements, season results; centre tabs and per-tab unread counts; push policy in core; settings for push and email | pgTAP 10 (38); core notifications (8); worker push policy; jest notifications (5) | Tested. Push **not delivered to a device** (A9) |
| EN13 | 13 Architecture | existing services only: Supabase (database, auth hook, storage, functions, jobs), Mapbox, Stream, Resend, Expo push, PostHog, Sentry | `npm run verify` | Unchanged stack |
| EN14 | 14 QA | `npm run verify`, pgTAP 11 suites, worker and app suites, Deno smoke, visual checks | `VERIFICATION.md` | See "Not verified" there |
| EN15 | 15 Completion report | this table, `PROGRESS.md`, `VERIFICATION.md`, the report in the conversation | — | Done |

## Deferred (PRD §9 "following release" / "later")

Not implemented and kept out of code paths: video, RSVP, divisions, shared crew ownership, frequency or cooldown capture rules, dedicated watch apps, direct wearable integrations, ranked imports, cross-device health backup, and medical or coaching features.
