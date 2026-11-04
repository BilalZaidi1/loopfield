# Implementation plan

Source of truth: *Territory Running App Product Research and Requirements*, v1.2 (4 Nov 2026), plus the founder's build brief (service choices override the PDF's vendor suggestions). Working codename **Loopfield** — a placeholder pending naming/clearance (PDF §22 open decision). Display name, bundle IDs and scheme are environment-configurable.

## Architecture (as built)

| Layer | Implementation | Authority |
|---|---|---|
| Mobile | Expo SDK 58 / RN 0.88 / Expo Router, TypeScript, native dev builds (EAS) | Recording, local queue, on-device health, previews only |
| Rules engine | `packages/core` — pure TypeScript, no runtime deps; shared by app, edge functions and worker | Loop/speed validation, title replay, health reconciliation, analytics allowlist, webhook verification |
| Database | Supabase Postgres + PostGIS (`supabase/migrations`), RLS on every exposed table, internal schema not exposed | Cell control, claim/title ledgers, publication, social audiences |
| Edge functions | Deno (`supabase/functions`) — tickets, uploads, chat tokens, webhooks, auth email hook, account lifecycle, job runner | Server-side validation entry points |
| Jobs | `internal.jobs` table with `FOR UPDATE SKIP LOCKED`; runner available as an edge function (pg_cron + pg_net) **and** as a Node container (`services/worker`) | Independently retryable territory, speed, publication, social, notification, media, email, account jobs |
| Maps | Mapbox via `@rnmapbox/maps`; bounded viewport RPCs return published cells only | Rendering only — never ownership |
| Messaging | Stream Chat (`stream-chat` JS client, custom UI); channels created server-side only | Delivery |
| Billing | RevenueCat (`react-native-purchases`), authenticated webhook + REST reconciliation | `public.entitlements` written by service role only |
| Analytics / errors | PostHog (allowlisted events, no autocapture/replay), Sentry (scrubbed, replay off) | — |
| Email | Resend via Supabase **Send Email Hook** (single path; SMTP not configured) + Resend delivery webhooks (Svix-signed) | — |
| Health | HealthKit (`@kingstinct/react-native-healthkit`), Health Connect (`react-native-health-connect`); protected on-device SQLite cache excluded from backup | Device only — never uploaded |

## Delivery sequence

1. Shared rules engine with exhaustive unit tests (territory/speed worked examples from Appendix A, health fixtures, analytics/scrubbing, webhook schemes, billing state machine).
2. Database schema, RLS, territory/speed SQL engines, social authorization, jobs, retention — tested on local Postgres 16 + PostGIS + pgTAP with a Supabase auth/storage shim.
3. Edge functions + job handlers; worker container; integration tests against the local database.
4. Mobile app: all 49 screen/panel definitions (Appendix D) plus subscription and operator screens, with real loading/empty/error/offline/permission states.
5. Connector configuration on isolated dev resources (Supabase `loopfield-dev`, Sentry projects, PostHog dashboards); Stream/RevenueCat/Resend secrets documented where unavailable.
6. Verification report, traceability, setup and device-build instructions.

## Scope rules

* P0 + P1 = first release (complete). P2 (FR28 paid subscriptions **as a selling feature**) is built and sandbox-testable but disabled by configuration (`paywall_enabled=false`) — the PDF's free pilot. No feature is gated behind premium by default.
* Explicitly deferred (PDF §9 "Following release"/"Later"): group chat, video, events/RSVP, divisions, shared crew ownership, frequency/cooldown capture rules, dedicated watch apps, direct wearable integrations, ranked imports, cross-device health backup, medical/coaching features. Kept out of the code paths; see `docs/TRACEABILITY.md` §Deferred.
* Every numeric threshold lives in `packages/core/src/rules/config.ts` with `status: 'proposed'` until field-validated (PDF §18 gates).
