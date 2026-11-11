# Setup: local development, staging and device builds

The working name **Loopfield** is a placeholder (naming and trademark clearance are open, PRD §22); display name, bundle ID and URL scheme come from environment variables.

## 1. Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js + npm | 22.13 or later 22.x (`.nvmrc`; React Native 0.88 and Expo SDK 58 need ^22.13) | everything |
| PostgreSQL + PostGIS + pgTAP | PostgreSQL 16, PostGIS 3.4, pgTAP 1.3 | database and integration tests (`scripts/test-db.sh`) |
| psql | 15 or later | tests, `scripts/setup-supabase.sh` (uses `\getenv`) |
| Deno | 2.9 | edge-function type check and smoke test (optional locally, used in CI) |
| Supabase CLI | 3.0.0 (pinned in CI) | staging deployment, `db push` rehearsal |
| EAS CLI | 18 or later | device builds |
| Xcode / Android Studio | current stable | only for local native builds (`expo run:*`) |

On Ubuntu/Debian: `sudo apt-get install postgresql-16 postgresql-16-postgis-3 postgresql-16-pgtap`. `scripts/test-db.sh` starts a throwaway cluster from `/usr/lib/postgresql/16/bin` on port 54329 (override with `PGBIN`, `PGTEST_PORT`), or uses an existing server when `PGTEST_URL` is set.

## 2. Repository layout

```
apps/mobile          Expo app (Expo Router, TypeScript); all screens in app/, services in src/
packages/core        Pure TypeScript rules engine shared by app, edge functions and worker
supabase/migrations  Schema, RLS, territory and speed engines, social/ops RPCs, jobs, storage, schedules
supabase/functions   Deno edge functions; _shared/ holds handlers, job registry and a synced copy of core
supabase/tests       pgTAP suites and a Supabase role/auth/storage shim for plain PostgreSQL
services/worker      Node job worker (container) running the same job handlers
scripts              verification, setup, type generation and smoke tests
docs                 plan, traceability, verification, decisions, manual steps, progress
```

## 3. Local development

```bash
npm install                      # root workspaces: core, worker, mobile
npm run verify                   # every check available on this machine (see docs/VERIFICATION.md)
```

Individual checks: `npm run test:core`, `npm run test:db`, `npm run test:worker`, `npm run test:edge` (needs Deno), `npm run test:cli-push` (needs the Supabase CLI), `npm run check:queries`, `npm run gen:types` (after any migration change; CI fails on stale types), `npm run sync:core` (after editing `packages/core`; CI checks the copy).

### Full local Supabase stack (optional)

`supabase start` needs Docker. `supabase/config.toml` is set up for it: email confirmations on, the Send Email hook pointing at the local `auth-email-hook` function, deep-link redirect URLs for `loopfield://` and the dev client.

```bash
export SEND_EMAIL_HOOK_SECRET="v1,whsec_$(openssl rand -base64 32)"   # config.toml requires a well-formed secret
supabase start
cp supabase/functions/.env.example supabase/functions/.env               # fill in; same SEND_EMAIL_HOOK_SECRET
supabase functions serve --env-file supabase/functions/.env
npm run worker                                                           # or rely on the jobs function + pg_cron
```

### Mobile app

The full app uses native modules (Mapbox, HealthKit, Health Connect, background location), so it runs best in a **development build** (section 5). It also opens in **Expo Go** for quick testing (section 6), with those features switched off.

```bash
cp apps/mobile/.env.example apps/mobile/.env     # public client identifiers only
cd apps/mobile
npx expo start --dev-client                      # after installing a development build (section 5)
npx expo start --go --tunnel                     # or: open in Expo Go from this computer (section 6)
```

`.env.example` already points at the `loopfield-dev` Supabase project and the EU PostHog project; their keys are public client identifiers. Without `EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY` the app shows a configuration screen instead of starting. Optional integrations (Mapbox token, Sentry DSN, RevenueCat keys) are off until set, and the app says so where they would appear.

## 4. Staging (hosted Supabase)

Use an isolated project (the development project is `loopfield-dev`, ref `xcykufhsjyhedkqginay`). Each command below is idempotent. Steps marked **dashboard** cannot be scripted with the tools available; they are also listed in `docs/MANUAL_STEPS.md`.

```bash
export SUPABASE_PROJECT_REF=xcykufhsjyhedkqginay
supabase login                                   # or export SUPABASE_ACCESS_TOKEN
scripts/setup-supabase.sh link migrate           # migrate lists pending migrations and asks first
scripts/setup-supabase.sh seed                   # development region only; refused when LOOPFIELD_ENV=production
cp supabase/functions/.env.example supabase/functions/.env   # fill in server secrets (never commit)
scripts/setup-supabase.sh secrets functions
export SUPABASE_DB_URL='postgresql://…'          # session pooler string from the dashboard
export JOBS_RUNNER_SECRET='…'                    # same value as in supabase/functions/.env
scripts/setup-supabase.sh vault check
scripts/setup-supabase.sh types                  # optional: types from the hosted schema (should match the committed file)
```

The development project currently has migrations `…000100`–`…000600` and the seed applied; `migrate` applies `…000700`–`…001400`. That exact path was rehearsed locally with Supabase CLI 3.0.0 (`npm run test:cli-push`), followed by the full pgTAP suite.

**Dashboard: Authentication**
1. *URL configuration*: Site URL `loopfield://`; redirect URL `loopfield://**` (`**` because `*` stops at `/`). Standalone builds (`pilot`, `preview`, `production`) only use this scheme. `exp+loopfield://**` is needed only for development builds, and the dashboard may reject the `+`; add the production scheme or universal-link domain when one exists.
2. *Providers → Email*: enable email sign-in, confirm email, secure email change; minimum password length 10 with lower, upper and digits (mirrors `config.toml`).
3. *Hooks → Send Email hook*: HTTPS, URL `https://<ref>.supabase.co/functions/v1/auth-email-hook`, **Generate secret**, then put that secret in `SEND_EMAIL_HOOK_SECRET` and run `scripts/setup-supabase.sh secrets` again. Do not configure custom SMTP: with the hook enabled, Supabase sends no email of its own, so every auth email goes out once, through Resend.

**Job runner.** Jobs run either in the `jobs` edge function (pg_cron calls it every minute once the Vault entries exist) or in the Node worker container (`services/worker`, with `Dockerfile`, `fly.toml` and `render.yaml`). Running both is safe: jobs are claimed with `FOR UPDATE SKIP LOCKED`.

**Deploying from GitHub.** `.github/workflows/deploy-staging.yml` ("Deploy backend") applies pending migrations, deploys every function and checks that each one answers. It runs from the Actions tab or on every push to the `deploy/dev` branch, and needs one repository secret, `SUPABASE_ACCESS_TOKEN` (optional: `SUPABASE_DB_PASSWORD`, variable `SUPABASE_PROJECT_REF`, default `loopfield-dev`). It never sets function secrets.

**Generated secrets.** The ticket-signing and job-runner secrets are created inside the database in Vault (`scripts/setup-supabase.sh vault`, already done for `loopfield-dev`) and read from there by the functions and by pg_cron, so nobody copies them. Only provider keys (Stream, Resend, RevenueCat, Expo) are entered as function secrets.

### Provider configuration

| Provider | Steps |
|---|---|
| **Resend** | Add and verify a sending domain (DNS records); create an API key with sending access → `RESEND_API_KEY`; set `RESEND_FROM` (an address on that domain) and optionally `RESEND_REPLY_TO`; add a webhook to `https://<ref>.supabase.co/functions/v1/resend-webhook` for `email.sent`, `email.delivered`, `email.bounced`, `email.complained` → signing secret into `RESEND_WEBHOOK_SECRET`. Email buttons open `APP_WEB_URL` (default `https://loopfield.expo.app`); optional emails carry one-click unsubscribe links served by the `email` function. In the Supabase dashboard (Authentication → Emails) also switch on the security notifications (password, email, sign-in method and verification method changes): they go through the Send Email hook. |
| **Stream Chat** | Create an app (choose the data region); enter the server key and secret as the function secrets `STREAM_API_KEY` and `STREAM_API_SECRET`. Then apply the channel configuration server-side, so the keys stay in Supabase: `select internal.enqueue_job('chat', 'configure_stream', '{}', 'configure-stream');` (or from a machine: `npm run setup:stream`, dry run first, then `-- --apply`). It creates the `loopfield_dm` and `loopfield_group` channel types (no read receipts, presence, typing, uploads, link previews or Stream push; group membership is set only by the backend), restricts grants, keeps auth and permission checks on, subscribes only `message.new` to the `stream-webhook` function, then reads the configuration back and fails on any difference. The app needs no Stream variable: the token endpoint returns the public key. |
| **RevenueCat** | Only for sandbox testing of the P2 subscription (paywall off by default). Create the project and the `premium` entitlement; public SDK keys → `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY`; secret API key → `REVENUECAT_SECRET_API_KEY`; webhook to `/functions/v1/revenuecat-webhook` with an Authorization header value → `REVENUECAT_WEBHOOK_AUTH`. Products and store agreements are manual. |
| **Sentry** | Create projects `loopfield-mobile` (React Native) and `loopfield-backend` (Node/Deno) in org `futurama-labs` (EU region, `https://de.sentry.io`). Mobile DSN → `EXPO_PUBLIC_SENTRY_DSN`; backend DSN → `SENTRY_DSN_BACKEND`; an org auth token with `project:releases` → `SENTRY_AUTH_TOKEN` as an EAS secret for source maps. Session Replay stays disabled in code. |
| **Mapbox** | Public token (`pk.`) restricted to the app's bundle identifiers → `EXPO_PUBLIC_MAPBOX_TOKEN`. The native SDK no longer needs a download token (`RNMAPBOX_MAPS_DOWNLOAD_TOKEN` is optional). Without a public token the app shows its list views instead of maps. Telemetry is disabled in code; attribution and logo stay visible. |
| **PostHog** | Project "Default project", EU cloud (`https://eu.i.posthog.com`). The dashboard *Loopfield pilot metrics* and its five funnel/retention insights already exist; they fill once events arrive. In the client, analytics is opt-in (`defaultOptIn: false`), autocapture, lifecycle events and session replay are off, GeoIP enrichment is disabled, and every event passes the allowlist in `packages/core/src/analytics/events.ts`. |
| **Expo push** | `EXPO_ACCESS_TOKEN` (with enhanced push security enabled for the project) lets the backend send pushes; APNs key and FCM credentials are uploaded through `eas credentials`. |

## 5. Device builds (EAS)

```bash
npm install -g eas-cli
cd apps/mobile
eas init                                   # creates the EAS project; put the ID in EAS_PROJECT_ID
eas env:create --environment development --name EXPO_PUBLIC_SUPABASE_URL --value … --visibility plaintext
eas env:create --environment development --name SENTRY_AUTH_TOKEN --value … --visibility secret
eas build --profile development --platform ios        # internal distribution to registered devices
eas build --profile development --platform android    # APK
npx expo start --dev-client
```

Repeat the `eas env:create` lines for each `EXPO_PUBLIC_*` value in `.env.example`. Profiles in `eas.json`:

* `pilot`: a standalone Android APK for testers anywhere (internal link, no dev server). It carries the development project's public client values, skips Sentry source-map upload and uses `withoutCredentials`, so it is signed with the template debug key: fine for internal testing, never for the Play Store, and testers uninstall it before installing a store build.
* `development` (dev client, internal), `development-simulator`, `preview` (internal, `preview` channel), `production` (store builds; not to be submitted without authorization).

Builds can also start from GitHub (Expo dashboard *Build from GitHub*, or the Expo connector) once the repository is linked to the Expo project with base directory `apps/mobile`; every profile sets `image: latest` for that. Bundle identifiers are `dev.loopfield.app.development` / `.preview` / `dev.loopfield.app` unless `APP_BUNDLE_ID` is set.

Platform notes:
* **HealthKit** needs the HealthKit capability on the App ID (the config plugin adds the entitlement) and a physical iPhone.
* **Health Connect** needs Android 9+ with the Health Connect app (built in from Android 14). Play Console requires the health permissions declaration before release.
* **Background location**: iOS "Always" permission and Android `ACCESS_BACKGROUND_LOCATION` with a foreground service; both stores review the justification (texts are in `app.config.ts`).

Local native builds also work (`npx expo prebuild` then `npx expo run:ios|android`). The generated `ios/` and `android/` folders are not committed.

## 6. Testing in Expo Go (no build, no Apple account)

Expo Go from the App Store or Play Store (version for SDK 58) can open the app's JavaScript directly. This is the quickest way onto an iPhone, because iPhone builds need the paid Apple Developer Program.

**Without a computer (published preview).** The Expo workflow `.eas/workflows/publish-expo-go-update.yml` publishes the current code to the `expo-go` channel with runtime version `exposdk:58.0.0` (`EXPO_GO_UPDATE=1` in `app.config.ts`). No Loopfield build has that runtime version, so installed builds never receive these updates. Run the workflow from the Expo dashboard (*Workflows*) or the Expo connector after pushing; it needs the project's GitHub base directory set to `apps/mobile`. Then:

1. Install Expo Go and sign in with the Expo account that owns the project (on iOS, Expo Go opens only your own projects).
2. Open `exp://u.expo.dev/2734ce29-57cb-4a7e-b82a-58ecbe115a1e?runtime-version=exposdk%3A58.0.0&channel-name=expo-go` on the phone (paste it into Safari), or scan the QR code from `https://qr.expo.dev/eas-update?projectId=2734ce29-57cb-4a7e-b82a-58ecbe115a1e&runtimeVersion=exposdk%3A58.0.0&channel=expo-go` with the camera.
3. To load newer code later, publish again and reopen the project in Expo Go.

**From a computer (live reload).** Clone the repository, `npm install` at the root (Node 22.13+), `cp apps/mobile/.env.example apps/mobile/.env`, then `cd apps/mobile && npx expo start --go --tunnel` and scan the QR code. `--go` is needed because `expo-dev-client` is installed, which otherwise makes the CLI target development builds; `--tunnel` works when the phone and computer are on different networks.

What differs in Expo Go (the app explains each one where it appears; nothing is simulated):

| Feature | In Expo Go |
|---|---|
| Maps (Mapbox) | Not included: map areas show "Maps are not included in Expo Go"; lists and summaries still work |
| Apple Health / Health Connect | Not included: Health shows "Not in Expo Go" |
| Run recording | Works only while the app is on screen. The screen stays on during a run; time spent outside the app is kept as a gap, and a reload marks the run as interrupted. No "Always" location prompt is shown |
| Push notifications | Depend on Expo Go's own push support (removed on Android since SDK 53); in-app notifications work |
| Email links (password reset) | Open the `loopfield://` scheme, which Expo Go does not handle |
| Everything else (sign-up, onboarding, competition, clubs, social, messages, settings, export) | Same as a build, against the `loopfield-dev` backend |

## 7. Web version (browser review)

The same app runs in a browser through React Native for Web, for reviewing screens and flows on a computer. Build it locally with `cd apps/mobile && npx expo export --platform web` (output in `dist/`), or deploy it to Expo Hosting with the Expo workflow `.eas/workflows/deploy-web.yml` (production URL on `expo.app`; it uses the pilot profile's public values).

* Recording, maps, Apple Health / Health Connect and push are phone-app features. The browser version says so where they appear: the browser variants `src/recording/db.web.ts`, `task.web.ts` and `src/health/cache.web.ts` hold no runs or health readings, and `metro.config.js` keeps the Mapbox and health SDKs out of the web bundle.
* React Native's `Alert` does nothing in a browser, so `WebAlertHost` shows alerts as an in-app dialog on web (never a browser `confirm()`).
* The user-facing edge functions accept browser requests only from the Expo Hosting origins (`loopfield` / `bilalzaidi95-loopfield` on `expo.app`, including `--<id>` previews) and `http://localhost:8081`; set `WEB_ALLOWED_ORIGINS` (function secret, comma-separated) for any other host. The *Deploy backend* workflow checks this after every deploy.
* The deployed site is public to anyone with its link, and sign-up there creates real accounts in `loopfield-dev`.
