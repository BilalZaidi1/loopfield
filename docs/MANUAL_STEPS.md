# Manual steps

Everything below needs a person: an account owner's credentials, a dashboard without an API in this build's tooling, a purchase or agreement, or a legal decision. Nothing here was done by the build. Commands and details are in `docs/SETUP.md`.

## A. To run the backend in the development project (`loopfield-dev`)

| # | Step | Why manual | Unblocks |
|---|---|---|---|
| A1 | `scripts/setup-supabase.sh link migrate` to apply migrations `…000700`–`…001400` | The connector's confirmation for statements containing `DELETE` (inside function bodies) was cancelled by the client; it was not retried or worked around. The CLI path was rehearsed locally with the same files. | Everything server-side beyond schema foundations |
| A2 | Create `supabase/functions/.env` from the example and run `scripts/setup-supabase.sh secrets functions` | Server secrets are entered by the owner; functions are not deployed yet | Uploads, tickets, chat tokens, webhooks, auth email |
| A3 | `scripts/setup-supabase.sh vault` (job runner URL and secret) | Needs the database connection string and the secret | Background jobs through pg_cron (or run the worker container instead) |
| A4 | Dashboard → Authentication: URL configuration, email provider settings, **Send Email hook** with a generated secret | Auth configuration is dashboard-only with the available tools | Sign-up, recovery and email-change mails through Resend |
| A5 | Resend: verify a sending domain (DNS), create an API key, add the delivery webhook | DNS ownership and key creation | All auth and club-invite email |
| A6 | Stream: create the app, copy server credentials, run `npm run setup:stream -- --apply` | No Stream connector; the script has been type-checked but not run against Stream | Direct messages |
| A7 | Sentry: an org owner or manager creates `loopfield-mobile` and `loopfield-backend` (member project creation is disabled in `futurama-labs`), then DSNs and an auth token go into the environment | Organization permission (`create_project` returned 403) | Error reporting, source maps, the staging error test |
| A8 | Mapbox: public token restricted to the bundle IDs (no download token is needed any more) | Account token | Maps in device builds |
| A9 | Push credentials (FCM for Android, APNs key for iOS) and, for iOS, the paid Apple Developer Program. The Expo project and GitHub link already exist and the Android `pilot` build works | Google/Apple developer accounts | Push notifications; any iPhone build |

## B. Before any external pilot

| # | Step | Owner |
|---|---|---|
| B1 | Choose the product name and clear the trademark; set `APP_DISPLAY_NAME`, `APP_BUNDLE_ID`, `APP_SCHEME` | Founder / counsel |
| B2 | Publish reviewed Terms, Privacy Policy and competition rules; set `EXPO_PUBLIC_TERMS_URL`, `_PRIVACY_URL`, `_SUPPORT_EMAIL`; bump `LEGAL_VERSION` / `COMPETITION_CONSENT_VERSION` | Counsel |
| B3 | Choose the launch city; build and review its region, districts and exclusion set (the seed is a labelled Karachi test rectangle). Claims stay blocked (`eligibility_data_unavailable`) until a region's exclusion review is marked complete | Ops |
| B4 | Field validation of every `proposed` threshold (`packages/core/src/rules/config.ts`) on the PRD §18 device matrix: locked-screen recording, loop closure, timing uncertainty, battery | QA |
| B5 | Device test pass: permission states (FR02), process-kill recovery (FR04), background recording (FR05), HealthKit / Health Connect connect, revoke, disconnect and export (FR46, FR51, FR53, FR54), screen reader and haptics (FR26) | QA |
| B6 | Security review: RLS, storage policies and function authorization (pgTAP covers the core paths), penetration test of the edge functions, secret rotation plan | Security |
| B7 | Staff accounts: grant `admin`, `moderator`, `route_reviewer`, `integrity_reviewer`, `territory_operator` or `support` roles (`ops_grant_role`) to named people; staffing for report and appeal handling times | Ops |
| B8 | Store listings, privacy labels / Data safety form, HealthKit and Health Connect declarations, background-location justification | Founder |

## C. Only if the paid tier is enabled later (P2)

| # | Step |
|---|---|
| C1 | App Store Connect and Play Console agreements, tax and banking |
| C2 | Products and the `premium` entitlement in RevenueCat; public SDK keys, secret API key, webhook Authorization value |
| C3 | Decide what, if anything, is premium. Core competition, basic social and health features, privacy and deletion stay free; `premium_features` in `app_config` starts empty |
| C4 | Sandbox purchase, renewal, refund, restore and expiry run-through on devices, then set `paywall_enabled` in `public.app_config` through a reviewed migration (deliberately not an operator switch) |

No step in this file should be done by automation without the owner's explicit go-ahead: store submission, purchases, production data changes and anything that sends email to real people.
