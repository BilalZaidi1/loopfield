# Loopfield

A running app where closed loops capture territory on a shared map, published routes carry independent speed titles, and runners follow each other, join clubs, message and track their own health data privately. Built from *Territory Running App — Product Research and Requirements* v1.2. "Loopfield" is a working name pending naming and trademark clearance.

| Part | Path | Stack |
|---|---|---|
| Mobile app (iOS, Android) | `apps/mobile` | Expo SDK 58, React Native 0.88, Expo Router, TypeScript |
| Rules engine | `packages/core` | dependency-free TypeScript, shared by app, functions and worker |
| Database | `supabase/migrations` | Supabase Postgres 17 + PostGIS, RLS on every exposed table |
| Edge functions | `supabase/functions` | Deno: session tickets, uploads, chat tokens, webhooks, auth email, account, billing sync, job runner |
| Job worker | `services/worker` | Node container running the same job handlers |
| Integrations | | Mapbox, PostHog, Sentry, Resend, Stream Chat (messages only), RevenueCat, HealthKit, Health Connect |

## Quick start

```bash
npm install
npm run verify        # type checks, unit, database, integration, schema and edge-function tests, lint, secret scan
```

The database, integration and edge steps need PostgreSQL 16 with PostGIS and pgTAP (and Deno and the Supabase CLI for the edge and deployment-rehearsal steps); `verify` reports anything it had to skip. To run the app you need a development build, because it uses native modules. See [docs/SETUP.md](docs/SETUP.md).

## Status

All first-release (P0 and P1) requirements and all 49 screen definitions are implemented; `docs/TRACEABILITY.md` shows which are covered by automated tests and which still need device or field evidence. Paid subscriptions (P2) are built but switched off for the free pilot. Automated checks pass (`docs/VERIFICATION.md`). Nothing has run on a phone yet, every gameplay threshold is still *proposed* pending field tests, and several hosted services still need owner setup (`docs/MANUAL_STEPS.md`). It is a complete first-release codebase awaiting device and field validation, not a production-ready product.

## Documentation

* [docs/SETUP.md](docs/SETUP.md): local development, staging, provider configuration, device builds
* [docs/MANUAL_STEPS.md](docs/MANUAL_STEPS.md): steps that need an account owner
* [docs/TRACEABILITY.md](docs/TRACEABILITY.md): FR01–FR54 and screens 01–49 mapped to code and tests
* [docs/VERIFICATION.md](docs/VERIFICATION.md): what was tested, how, and what was not
* [docs/DECISIONS.md](docs/DECISIONS.md): defaults and design decisions
* [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) and [docs/PROGRESS.md](docs/PROGRESS.md)

## Configuration

Client-safe values only in `apps/mobile/.env` (`apps/mobile/.env.example`); server secrets only in `supabase/functions/.env` (`supabase/functions/.env.example`), uploaded with `scripts/setup-supabase.sh secrets`. Build-time tokens (Sentry source maps, Mapbox SDK download) belong in EAS secrets. Nothing secret is committed; `npm run verify` scans for it.
