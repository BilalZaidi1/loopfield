#!/usr/bin/env bash
# Full local verification. Every step reports PASS, FAIL or SKIPPED (with the reason); the script exits non-zero
# if any step fails. A skipped step was NOT verified.
#
#   npm run verify                 everything available on this machine
#   DENO=/path/to/deno npm run verify    use a specific Deno binary for the edge-function steps
#   PGTEST_URL=postgres://…/postgres     use an existing PostgreSQL 16+ server with PostGIS and pgTAP (CI)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DENO_BIN="${DENO:-$(command -v deno || true)}"
declare -a RESULTS=()
FAILED=0
LOG_DIR="${VERIFY_LOG_DIR:-${TMPDIR:-/tmp}/loopfield-verify}"
mkdir -p "$LOG_DIR"

step() {
  local name="$1"; shift
  local log="$LOG_DIR/$(echo "$name" | tr ' /' '__').log"
  printf '%-44s' "$name"
  if "$@" >"$log" 2>&1; then
    echo "PASS"; RESULTS+=("PASS  $name")
  else
    echo "FAIL  (log: $log)"; tail -25 "$log" | sed 's/^/    /'; RESULTS+=("FAIL  $name"); FAILED=1
  fi
}
skip() {
  printf '%-44s%s\n' "$1" "SKIPPED ($2)"; RESULTS+=("SKIP  $1 — $2")
}

secret_scan() {
  # Real credential shapes only; placeholders in .env.example files are empty. Public client identifiers
  # (Supabase publishable keys, PostHog project keys) are allowed in apps/mobile/.env.example by design.
  # Service-role JWTs are matched on the base64 forms of "service_role" (three byte alignments).
  local pattern='(sb_secret_[A-Za-z0-9_-]{10,}|\bsk_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9+/=]{20,}|\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sntrys_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*(c2VydmljZV9yb2xl|NlcnZpY2Vfcm9sZ|zZXJ2aWNlX3JvbG))'
  if git ls-files -z | xargs -0 grep -nE "$pattern" -- 2>/dev/null | grep -vE '^(package-lock\.json|scripts/verify\.sh):'; then
    echo "possible secret committed (see matches above)"; return 1
  fi
  # Nothing secret may be exposed to the app bundle through EXPO_PUBLIC_*.
  if git ls-files -z | xargs -0 grep -nE 'EXPO_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE|PRIVATE|WEBHOOK|API_SECRET)' -- 2>/dev/null; then
    echo "secret-like EXPO_PUBLIC_ variable"; return 1
  fi
  echo "no secrets found in tracked files"
}

edge_check() { (cd supabase/functions && "$DENO_BIN" check --quiet --config deno.json */index.ts); }

echo "Loopfield verification — $(date -u +%Y-%m-%dT%H:%MZ)"
step "core copy in sync (sync-core --check)" node scripts/sync-core.mjs --check
step "typecheck: core, worker, mobile" npm run typecheck --silent
step "typecheck: scripts" npx tsc -p scripts/tsconfig.json
step "unit tests: rules engine (vitest)" npm run test:core --silent
if command -v psql >/dev/null && { [[ -n "${PGTEST_URL:-}" ]] || [[ -x "${PGBIN:-/usr/lib/postgresql/16/bin}/pg_ctl" ]]; }; then
  step "database: migrations + pgTAP" bash scripts/test-db.sh
  step "integration tests: jobs, webhooks (vitest)" npm run test:worker --silent
  step "generated DB types are current" bash scripts/gen-types.sh --check
  step "app queries match schema (selects, rpc args)" node scripts/check-client-queries.mjs
  SUPABASE_BIN="${SUPABASE_CLI:-$(command -v supabase || true)}"
  if [[ -n "$SUPABASE_BIN" ]]; then
    step "supabase db push rehearsal + pgTAP" env SUPABASE_CLI="$SUPABASE_BIN" bash scripts/test-cli-push.sh
  else
    skip "supabase db push rehearsal" "Supabase CLI not installed; set SUPABASE_CLI"
  fi
  if [[ -n "$DENO_BIN" ]]; then
    step "edge functions: deno check" edge_check
    step "edge functions: Deno smoke (HTTP)" env DENO="$DENO_BIN" node scripts/smoke-functions.mjs
  else
    skip "edge functions: deno check + smoke" "Deno not installed; set DENO=/path/to/deno"
  fi
else
  skip "database, integration, schema and edge steps" "no PostgreSQL 16 + PostGIS + pgTAP available (set PGTEST_URL)"
fi
step "mobile: lint (eslint)" npm run lint -w @loopfield/mobile --silent
step "mobile: unit tests (jest)" npm run test -w @loopfield/mobile --silent -- --ci
step "secret scan" secret_scan

echo
echo "Summary"
printf '  %s\n' "${RESULTS[@]}"
if [[ $FAILED -ne 0 ]]; then echo "VERIFICATION FAILED"; exit 1; fi
echo "All executed steps passed. Native builds, device tests and hosted services are not covered by this script."
