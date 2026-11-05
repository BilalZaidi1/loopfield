# Verification status

Last full run: 5 November 2026, Linux cloud workspace (Node 22.23, PostgreSQL 16.15 + PostGIS 3.4 + pgTAP, Deno 2.9.6, Supabase CLI 3.0.0), commit containing this file. Reproduce with `npm run verify` (CI runs the same script in `.github/workflows/ci.yml` on pushes to `main` and on pull requests; it has not run yet, because the work is on the `verification-and-docs` branch without a pull request).

**This is not a production-readiness statement.** Compiling, unit tests and integration tests against a local database say nothing yet about real devices, field GPS behaviour, store review or hosted-service configuration. Those are listed under "Not verified".

## Automated checks (all passing)

| Check | Command | Result |
|---|---|---|
| Rules engine unit tests | `npm run test:core` | 67 tests, 5 files |
| Core copy used by edge functions in sync | `node scripts/sync-core.mjs --check` | in sync |
| Type checks | `npm run typecheck`, `tsc -p scripts` | core, worker, mobile (typed Supabase client), scripts: 0 errors |
| Migrations + pgTAP | `npm run test:db` | 14 migrations; 114 assertions in 5 suites (RLS/grants 22, territory 26, speed 12, social 30, lifecycle/jobs/ops 24) |
| Hosted deployment path | `npm run test:cli-push` | `supabase db push` (CLI 3.0.0) applied all 14 migrations to a fresh database; the same 114 assertions pass on the result |
| Integration tests (jobs, webhooks, uploads, concurrency) | `npm run test:worker` | 25 tests, 3 files, against PostgreSQL; includes the browser origin allowlist (lookalike domains rejected) |
| Generated database types current | `scripts/gen-types.sh --check` | up to date (postgres-meta 0.100.0, the generator behind `supabase gen types`) |
| App queries match the schema | `npm run check:queries` | 32 select strings and 110 of 111 RPC calls: no unknown table, column, relationship, function or argument, no missing required argument |
| Edge functions type check | `deno check` on all 10 entrypoints | 0 errors |
| Edge functions under the Deno runtime | `npm run test:edge` | 45 HTTP checks. CORS: the five user-facing functions answer browser preflights only for the web app's origins (Expo Hosting, local web development) and still reject requests without a session; webhooks get no CORS. Also: method guard, missing or bad signatures (Stream HMAC, Svix for Resend, Standard Webhooks for the auth hook incl. stale timestamp), RevenueCat Authorization and duplicate delivery, jobs secret, session rejection on all five user endpoints, `not_configured` when Resend is unset |
| Mobile lint | `npm run lint -w @loopfield/mobile` | 0 errors, 16 style warnings |
| Mobile unit tests | `npm run test -w @loopfield/mobile` | 36 tests, 9 suites. 6 cover the browser version: no local recordings and recording refused, no health readings, goals kept in browser storage, alerts shown as an in-app dialog, settings links explained. 9 of them load the app as Expo Go runs it and as a build runs it: in Expo Go no Mapbox, HealthKit or Health Connect module is loaded and the screens say why, recording uses foreground updates with the screen kept on, and a reload is marked as an interruption; in a build, background updates are used and a refusal falls back to foreground recording |
| Expo Go runtime | `EXPO_GO_UPDATE=1 npx expo-updates runtimeversion:resolve` | `exposdk:58.0.0`. Without the switch the pilot configuration is unchanged: the Android fingerprint computed here is identical before and after the change |
| Secret scan | part of `verify.sh` | no credential shapes in tracked files; no secret-like `EXPO_PUBLIC_*` names |
| JavaScript bundles | `npx expo export --platform android --platform ios` (and `--platform web`) | both Hermes bundles build (14 MB each); the web export builds and its welcome screen renders in headless Chromium without page errors. The only secret-looking strings in them are the prefixes the client's own guard rejects (`sb_secret_`, `whsec_`) |
| Android cloud build | Expo Build, profile `pilot`, from GitHub `BilalZaidi1/loopfield` (5 Nov) | the native Android app compiles: build `3905eb83…` produced an installable APK in 29 minutes (commit `7b04897`). Not yet installed on a phone |
| Native project generation | `npx expo prebuild --clean --no-install` (run 4 Nov) | succeeds; AndroidManifest has `allowBackup=false`, health permissions, background location and the permissions-rationale intent; iOS has location/remote-notification/fetch background modes and the HealthKit entitlement |
| Expo doctor | `npx expo-doctor` (4 Nov) | 18/20; both failures were network checks to `exp.host`, unreachable from the workspace |

## Defects found by verification and fixed

* **Edge cold start broke the job runner.** postgres.js `sql.array()` sends `a,b` instead of `{a,b}` on the first query of a new connection, so the `jobs` function failed on every cold start and the worker's first batch failed. All array parameters now use an explicit literal (`pgArray` in `_shared/clients.ts`); regression tests in `services/worker/test/runtime.test.ts`.
* **Missing integration configuration was reported as a 500.** `ConfigError` lacked its `name`, so "not configured" errors fell through to `internal_error`. Fixed; covered by the runtime test and the Deno smoke test.
* **Protected-area insert** could be sent without a user ID before the session loaded (found when the Supabase client became typed). Guarded.
* **Deprecated Supabase config key** `auth.email.enable_signup` replaced with `auth.email.enabled` (reported by CLI 3.0.0).
* **The first cloud build failed** its Android library check: the app pinned compileSdk 36, but Expo SDK 58 libraries need 37. Fixed; the second build succeeded. The build server's `expo doctor` also flagged Jest 29 where SDK 58 expects Jest 30, now aligned (with Testing Library 14, whose `render` is async).
* **Cloud builds would have used an unsupported Node version.** `eas.json` pinned Node 22.11, but React Native 0.88 and Expo SDK 58 require ^22.13; now 22.23.4, the version tested here.
* **No test covered data export (FR09) or exploration history after a loss (FR19)**; added both. The export test also checks that the export row is invisible to other users under RLS.
* Earlier in the build: two copies of React in the workspace (would have broken the Metro bundle), and five app-to-schema mismatches (notes length, moderation statuses and priority, export status, club join policy, follower messaging label), all fixed.

## Hosted resources

| Service | State | Evidence |
|---|---|---|
| Supabase `loopfield-dev` (ref `xcykufhsjyhedkqginay`, PG 17, ap-south-1) | All 14 migrations applied and all 10 edge functions deployed (5 Nov) by the GitHub "Deploy backend" workflow with Supabase CLI 3.0.0; every function answered its post-deploy check. Job runner verified end to end: pg_cron called the `jobs` function, which authenticated with the Vault-held secret and ran a queued job. Generated secrets are in Vault; provider keys (Stream, Resend) not yet entered | `list_migrations`, `list_edge_functions`, `net._http_response` (`claimed: 1`). Security advisor: one intentional INFO (`exclusion_zones` read only through RPCs) and 86 WARN that signed-in users can call `SECURITY DEFINER` functions: these are the app's API, each checks the caller (pgTAP tests cover the authorization), and anonymous callers cannot execute any |
| PostHog (EU, project 333912) | Dashboard *Loopfield pilot metrics* (id 1086305) with five insights: first-run activation, second-run conversion, onboarding to first upload, return after lost land, week-four retention | Created through the connector. Empty until the app sends events; no alerts configured for that reason. Session replay was already off at project level |
| Sentry (`futurama-labs`) | No projects | `create_project` returned 403 (member project creation disabled). The staging error test has **not** run |
| Resend | No domain, no webhook | `list-domains`, `list-webhooks` |
| Expo (`@bilalzaidi95/loopfield`) | Project linked to GitHub `BilalZaidi1/loopfield` (base directory `apps/mobile`, set 5 Nov). Android `pilot` APK `b2012e6b…` (runtime `5a39a10…`) shareable through Expo's internal distribution link. 5 Nov, through Expo workflows: **pilot update** group `71f4bf28…` published for runtime `5a39a10…` (the APK's runtime, so the installed APK takes it on its next two launches) with `EXPO_PUBLIC_MAPBOX_TOKEN` loaded from the `preview` environment; **Expo Go preview** group `5f5da2cf…` on channel `expo-go`, runtime `exposdk:58.0.0`, iOS and Android. Free-plan jobs waited about 35 minutes in Expo's queue before running for 3–5 minutes. The runtime version computed in this workspace (`d0d57d9…`) differs from Expo's for the same commit, so only Expo's own computation predicts whether an update reaches a build | Expo connector `build_run` / `build_info` / `workflow_run` / `workflow_info` / `workflow_logs` |
| Stream, RevenueCat, Mapbox | Not configured | No connector or credentials for configuration in this session |

## Not verified

* **Devices.** The owner reports the installed Android APK runs but shows no maps: that build was made before the Mapbox token existed in Expo. The pilot update above adds the token; its effect on the phone is not yet confirmed. The Expo Go preview has not yet been opened on an iPhone, and no iOS build exists. Untested on device: permissions and their denied/approximate/revoked states, background and locked-screen recording, process-kill recovery, HealthKit and Health Connect reads, writes, revocation and clearing, push delivery and tap routing, Mapbox rendering, deep links (auth callback, invites), RevenueCat purchases.
* **Field behaviour.** Every threshold in `packages/core/src/rules/config.ts` is `proposed`; none has field evidence (PRD §14, §18). GPS accuracy, loop closure in real streets, timing uncertainty and battery use are unknown.
* **Hosted runtime.** Edge functions ran under plain Deno against a local database, not in Supabase's edge runtime; user-session paths were only checked for rejection, because Supabase Auth was not available locally. Stream, RevenueCat, Resend and Expo push were exercised with in-process fakes (worker tests), never against the real services. `scripts/setup-stream.ts` is type-checked and its argument guards ran; it has not run against Stream.
* **Accessibility.** Logic for cues, chart tables and map summaries is unit-tested; no VoiceOver/TalkBack pass has happened.
* **CI.** The *Deploy backend* GitHub workflow has run four times (all succeeded; since 5 Nov it also checks CORS on the hosted functions). The *CI* workflow runs on `main` and pull requests and has not run yet.
* **Security.** No external review or penetration test. Load and concurrency beyond the integration test's concurrent claims were not measured.
