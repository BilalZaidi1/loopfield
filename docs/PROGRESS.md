# Progress log

Working file kept current so work survives context limits. Newest first.

## 11 Nov 2026: movement points, reclaiming, challenges and global ranking

* Requested 6 Nov, outside PRD v1.2 (traced as MP1–MP3, RC1–RC4, AC1–AC3, UI1 in `TRACEABILITY.md`; rules and numbers in `DECISIONS.md`).
* Backend (migration `20261106000100`): points ledger and balances from server-verified distance of every run (public or private), daily cap, revocation and reinstatement with run outcomes, self-healing sweep; lost-cell queries and `reclaim_cells` (one transaction, request ids, rate limit, eligibility re-checked, reclaims applied as one-cell claims so newest-wins and replay still hold, published at once, refunds and withdrawals on invalidation); 24 challenges in six categories with automatic tiered badges, score and ranking with everyone, country, region, friends and club scopes and privacy rules.
* App: points pill, lost-cell layer, reclaim mode and list flow with a receipt and confirmation on the Map; points screen; challenges and badges; global ranking; profile achievements; points on run summaries; badge and refund notifications; Help sections.
* Also fixed: native maps drew no cells at all, because server cell ids are decimal text (see `VERIFICATION.md`).
* Visual review in a browser found eleven layout and wording defects, all fixed (`VERIFICATION.md`).
* Deployed 11 Nov from `116add2`: backend to `loopfield-dev` through the Deploy backend workflow (`deploy/dev`), then the pilot update (group `c890905a…`, runtime `d0d57d9…`, reaches the replacement APK), the Expo Go preview (group `2908f0c4…`) and the web preview (`loopfield.expo.app`, deployment `q63gw1nq33`).

## 6 Nov 2026: frontend redesign

* New design system (`docs/DESIGN.md`): semantic light and dark tokens, module colours, Figtree type scale loaded as JS assets, motion that respects Reduce Motion, new icon set, rebuilt component library, one stack header with a real "Back" label, a tab bar with a raised Record button and a sidebar on wide screens, animated splash.
* Theme: System / Light / Dark in Settings, saved per device; native pieces follow the choice.
* Map: full-bleed game board with theme base maps, glowing own land, rival hues, dashed unavailable areas, a faint cell grid, route casings, pulsing location, floating controls, a bottom sheet with the text summary and panels for tapped cells and routes, and a map key. Ownership, scoring, speed and validation code unchanged.
* Every screen redesigned (auth, onboarding, Home dashboard, Map, Record, live run, summary, history, progress, health, clubs, social, profile, settings, help, reports, operator tools) plus a first-run tour; social sign-in buttons appear only for providers enabled in Supabase.
* Review fixes folded in: welcome actions pinned on screen, "Resend verification" only after an unverified sign-in, show-password toggle, Back label, real map summary without a drawable map, readable chart dates (and a time-zone fix for week keys), health type toggles hidden where health cannot connect, speed routes listed without a map, browser-specific goals copy.
* No backend contract or schema change; no new native module (local fingerprint unchanged), so the redesign ships as an update to the existing pilot build and to Expo Go.

## Status snapshot (5 Nov 2026)

| Area | State | Evidence |
|---|---|---|
| Rules engine `packages/core` | Done | 67 unit tests |
| Database (14 migrations) | Done locally; dev project has `…000100`–`…000600` + seed | 114 pgTAP assertions; `supabase db push` rehearsal passes |
| Edge functions (10) and worker | Done; not deployed | 21 integration tests; `deno check`; 24 Deno HTTP smoke checks |
| Mobile app (49 screens + subscription, club creation, operator tools) | Done; Android APK built in the cloud; no device run yet | typecheck, lint, 21 jest tests, Android/iOS bundles, prebuild, Expo Android build |
| Generated DB types + query checks | Done | `gen-types --check`, `check:queries` |
| Connectors | Supabase dev project, PostHog dashboard done; Sentry blocked (403); Resend, Stream, RevenueCat, Mapbox, EAS need the owner | `docs/VERIFICATION.md` §Hosted resources |
| Docs, CI, setup scripts | Done | `docs/*`, `.github/workflows/*`, `scripts/*` |

## 5 Nov 2026 (afternoon)

* Code pushed to GitHub `BilalZaidi1/loopfield` (`main` and `verification-and-docs`); Expo project `@bilalzaidi95/loopfield` linked to it.
* Android `pilot` profile added (standalone internal APK, development backend values, no signing credentials). First cloud build failed (compileSdk 36 → needs 37); second build succeeded: build `3905eb83-c70c-4439-b343-02c7e6230053`.
* Jest 30 / Testing Library 14 alignment after the build server's `expo doctor` check.
* Still open before useful testing: database migrations `…000700`+, edge functions and secrets, Auth URL settings (`docs/MANUAL_STEPS.md` A1–A4).

## 5 Nov 2026

* Added generated Supabase types (postgres-meta over the migrations) and typed the app's client; RPC names are now compile-checked and `scripts/check-client-queries.mjs` checks select columns and RPC arguments.
* Installed Deno 2.9.6 and Supabase CLI 3.0.0 in the workspace: all edge functions type-check; a Deno smoke test exercises every function over HTTP; `supabase db push` applies all migrations to a fresh database and the pgTAP suite passes on it.
* Fixed two runtime defects found that way (postgres.js array parameters on cold start; `ConfigError` reported as 500) with regression tests; fixed a protected-area insert guard and a deprecated config key; added the missing data-export (FR09) and exploration (FR19) tests.
* Wrote `scripts/verify.sh`, `setup-supabase.sh`, `setup-stream.ts`, `gen-types.sh`, `test-cli-push.sh`, `smoke-functions.mjs`, CI and staging workflows, `supabase/functions/.env.example`, and the docs.
* Remote migrations `…000700`+ were left for the owner (`scripts/setup-supabase.sh migrate`): the connector's confirmation for statements containing `DELETE` had been cancelled by the client and was not retried.

## 4 Nov 2026

* Rules engine, schema, RLS, territory and speed engines, social and ops APIs, jobs, storage, schedules; pgTAP suite with a Supabase shim.
* Edge functions, shared job handlers, Node worker, integration tests.
* Mobile app: all screens, recording and upload queue, maps, chat, billing, push, on-device health.
* Supabase `loopfield-dev` created (ap-south-1); first six migrations and the seed applied; advisors reviewed; performance fixes written as migration `…001400`. PostHog dashboard and five insights created. Sentry project creation refused for the member account.

## Next steps

1. Owner: `docs/MANUAL_STEPS.md` section A (migrations, secrets, functions, auth hook, Resend, Stream, Sentry, Mapbox, EAS).
2. First development builds on one iPhone and one mid-range Android; run the device checks in `docs/MANUAL_STEPS.md` B5.
3. Field calibration of the proposed thresholds before any public competition.
