#!/usr/bin/env bash
# Rehearses the hosted deployment path locally: applies supabase/migrations to a fresh database with the
# Supabase CLI's own `db push` (the command used against staging), then runs the pgTAP suite on the result.
# Uses the same disposable PostgreSQL as scripts/test-db.sh (or PGTEST_URL) plus the Supabase role/auth shim.
#
#   SUPABASE_CLI=/path/to/supabase scripts/test-cli-push.sh      (defaults to `supabase` on PATH)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${SUPABASE_CLI:-supabase}"
command -v "$CLI" >/dev/null || { echo "Supabase CLI not found; set SUPABASE_CLI"; exit 2; }
DB=loopfield_clipush
BASE="$(bash "$ROOT/scripts/test-db.sh" --server-only | tail -1)"
psql -q "$BASE/postgres" -c "drop database if exists $DB with (force)" -c "create database $DB" 2>/dev/null
psql -q "$BASE/$DB" -c "alter database $DB set search_path = \"\$user\", public, extensions"
psql -q "$BASE/$DB" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/shim/supabase_shim.sql" 2> >(grep -v NOTICE >&2)
# The CLI validates config.toml, which requires a well-formed hook secret; a throwaway one is enough here.
SEND_EMAIL_HOOK_SECRET="v1,whsec_$(openssl rand -base64 32)" SUPABASE_TELEMETRY_DISABLED=1 \
  "$CLI" db push --remote="$BASE/$DB?sslmode=disable" --skip-vault --yes --agent no --workdir "$ROOT"
psql -q "$BASE/$DB" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed.sql"
psql -q "$BASE/$DB" -c "create extension if not exists pgtap with schema extensions"
fail=0
for t in "$ROOT"/supabase/tests/sql/*.sql; do
  out=$(psql "$BASE/$DB" -X -v ON_ERROR_STOP=1 -t -A -f "$t" 2>&1) || { echo "ERROR in $(basename "$t")"; echo "$out" | tail -20; fail=1; continue; }
  if echo "$out" | grep -qE "^not ok|Looks like you failed"; then echo "FAIL $(basename "$t")"; echo "$out" | grep -E "^not ok" | head -20; fail=1
  else echo "ok   $(basename "$t") ($(echo "$out" | grep -cE '^ok') assertions)"; fi
done
echo "migration history rows: $(psql -X -A -t "$BASE/$DB" -c 'select count(*) from supabase_migrations.schema_migrations')"
psql -q "$BASE/postgres" -c "drop database $DB with (force)"
exit $fail
