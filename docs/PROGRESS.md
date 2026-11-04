# Progress log

Working file kept current so work survives context limits. Newest entries first.

## Status snapshot (2026-11-04)

| Area | State | Evidence |
|---|---|---|
| Rules engine `packages/core` | Implemented | `npm run test:core` — 67 unit tests, typecheck clean |
| Database migrations (13) | Implemented, applied to local PG16+PostGIS 3.4 | `npm run test:db` — 114 pgTAP assertions across 5 files |
| Edge functions / worker | In progress | — |
| Mobile app | Not started | — |
| Connectors | Supabase dev project `loopfield-dev` (ref `xcykufhsjyhedkqginay`, ap-south-1, Free org) created; nothing applied yet | — |

## Decisions recorded

* Working codename **Loopfield** (placeholder; naming/clearance is an open PRD decision).
* Expo SDK 58 / React Native 0.88.1 / React 19.3 / TypeScript ~6.0 (template default; typescript-eslint supports <6.1).
* H3 is not available on Supabase (checked `list_extensions`): the worker computes H3 cells with `h3-js`; PostGIS remains authoritative for validity, area, inward band, containment, exclusions and masks.
* Partition locking via transaction advisory locks on H3 res-7 parents (sorted) instead of row-lock ordering.
* Published vs authoritative state kept separately (cell_control vs cell_control_public; speed_titles.published_*) to enforce the 30-minute publication delay.
* Fail-closed eligibility: claims in regions without a reviewed exclusion set get `eligibility_data_unavailable`.
* Contest consent flags only change through `set_consent` (column privileges); withdrawal queues result withdrawal.
* Route geometry is built server-side from evidence; clients never upload route geometry.
* Dev seed = one labelled development region (Karachi test rectangle), no users or activity.

## Commands

```
npm install                 # root (workspaces)
npm run test:core           # rules engine
npm run test:db             # migrations + pgTAP (starts a throwaway PG16 cluster on :54329)
```

## Next steps

1. Job handlers + worker (Node) + `jobs` edge function; integration tests incl. concurrent claims.
2. Edge functions: session-ticket, activity-upload, chat, stream-webhook, revenuecat-webhook, auth-email-hook, resend-webhook, media/account helpers.
3. Mobile app (49 screens + subscription + ops).
4. Apply migrations to `loopfield-dev`, generate types, deploy functions, Sentry projects, PostHog dashboards.
5. Traceability, verification report, setup docs.
